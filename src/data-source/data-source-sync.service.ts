import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, In, Repository } from 'typeorm';
import { isDeepStrictEqual } from 'node:util';
import { DataSourceEntity, FieldMapping } from './data-source.entity';
import { DataSourceSyncLogEntity } from './data-source-sync-log.entity';
import { DataSourceProviderFactory } from './data-source-provider.factory';
import { DataSourceService } from './data-source.service';
import { DatasetService } from '../dataset/dataset.service';
import { DatasetEntity, DatasetField } from '../dataset/dataset.entity';
import { DatasetRecordEntity } from '../dataset/dataset-record.entity';
import { ExecutionService } from '../execution/execution.service';
import { ExecutionPriority } from '../execution/execution-priority.enum';
import {
  canonicalDomainHash,
  contentHash,
} from '../execution/execution-canonical';

export interface PreparedDataSourceSync {
  dataSourceId: number;
  sourceIdentityHash: string;
  records: Record<string, any>[];
  schema: DatasetField[];
  error: string | null;
}

export interface AppliedDataSourceSync {
  status: 'success' | 'failed';
  syncLogId: number;
  observation: Record<string, unknown>;
}

@Injectable()
export class DataSourceSyncService {
  private readonly logger = new Logger(DataSourceSyncService.name);

  constructor(
    private readonly providerFactory: DataSourceProviderFactory,
    private readonly dataSourceService: DataSourceService,
    private readonly datasetService: DatasetService,
    private readonly executionService: ExecutionService,
  ) {}

  async syncDataSource(dataSourceId: number): Promise<{ executionId: string }> {
    await this.dataSourceService.findOne(dataSourceId);
    const execution = await this.executionService.create(
      'data-source-sync',
      ExecutionPriority.NORMAL,
      { dataSourceId },
    );
    return { executionId: execution.executionId };
  }

  async prepareSync(dataSourceId: number): Promise<PreparedDataSourceSync> {
    const source = await this.dataSourceService.findOne(dataSourceId);
    const sourceIdentityHash = this.sourceIdentityHash(source);
    const provider = this.providerFactory.getProvider(source.providerType);
    if (!provider) {
      return {
        dataSourceId,
        sourceIdentityHash,
        records: [],
        schema: [],
        error: `Unknown provider type: ${source.providerType}`,
      };
    }
    try {
      const credentials =
        this.dataSourceService.getDecryptedCredentials(source);
      const records: Record<string, any>[] = [];
      let cursor: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const page = await provider.fetch(
          source.config,
          credentials ?? undefined,
          cursor,
        );
        records.push(...page.records);
        hasMore = page.hasMore ?? false;
        cursor = page.cursor;
        if (hasMore && source.rateLimitRpm) {
          const delay = Math.ceil(60_000 / source.rateLimitRpm);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      const mapped = this.applyMapping(records, source.schemaMapping);
      const schema = source.schemaMapping?.length
        ? source.schemaMapping.map((mapping) => ({
            key: mapping.targetFieldKey,
            name: mapping.targetFieldName,
            type: mapping.targetFieldType,
            required: false,
          }))
        : this.inferSchema(mapped);
      return {
        dataSourceId,
        sourceIdentityHash,
        records: mapped,
        schema,
        error: null,
      };
    } catch (error) {
      return {
        dataSourceId,
        sourceIdentityHash,
        records: [],
        schema: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async applyPreparedSync(
    prepared: PreparedDataSourceSync,
    manager: EntityManager,
  ): Promise<AppliedDataSourceSync> {
    const sources = manager.getRepository(DataSourceEntity);
    const source = await sources.findOne({
      where: { id: prepared.dataSourceId },
      relations: ['project', 'dataset'],
      lock: { mode: 'pessimistic_write' },
    });
    if (!source) throw new Error('data_source_sync_source_not_found');
    if (this.sourceIdentityHash(source) !== prepared.sourceIdentityHash) {
      throw new Error('data_source_sync_source_changed');
    }
    const startedAt = new Date();
    if (prepared.error) {
      return this.persistFailure(manager, source, prepared.error, startedAt);
    }

    const datasets = manager.getRepository(DatasetEntity);
    const records = manager.getRepository(DatasetRecordEntity);
    let dataset = source.dataset;
    if (prepared.records.length && !dataset) {
      dataset = datasets.create({
        name: source.name,
        description: source.description || `Data from ${source.providerType}`,
        schema: prepared.schema,
        sourceMode: 'manual',
        sourceConfig: {},
        extractionConfig: null,
        project: source.project ? ({ id: source.project.id } as any) : null,
      });
      dataset = await datasets.save(dataset);
      source.dataset = dataset;
    }

    let created = 0;
    let updated = 0;
    const touched: DatasetRecordEntity[] = [];
    let fullReplaceDatasetId: number | null = null;
    if (dataset && prepared.records.length) {
      const validated = this.datasetService.prepareValidRecords(
        prepared.schema,
        prepared.records,
      );
      if (source.syncStrategy === 'incremental' && source.incrementalKey) {
        const existing = await records.find({
          where: { dataset: { id: dataset.id } },
        });
        const byKey = new Map(
          existing
            .map(
              (record) =>
                [
                  String(record.data?.[source.incrementalKey!] ?? ''),
                  record,
                ] as const,
            )
            .filter(([key]) => key),
        );
        for (const data of validated.records) {
          const key = String(data[source.incrementalKey] ?? '');
          const current = key ? byKey.get(key) : undefined;
          if (current) {
            current.data = data;
            touched.push(await records.save(current));
            updated += 1;
          } else {
            touched.push(
              await records.save(this.newRecord(records, dataset.id, data)),
            );
            created += 1;
          }
        }
      } else {
        fullReplaceDatasetId = dataset.id;
        await records.delete({ dataset: { id: dataset.id } });
        for (const data of validated.records) {
          touched.push(
            await records.save(this.newRecord(records, dataset.id, data)),
          );
        }
        created = touched.length;
      }
    }

    const finishedAt = new Date();
    const logs = manager.getRepository(DataSourceSyncLogEntity);
    const log = await logs.save(
      logs.create({
        dataSource: { id: source.id } as any,
        status: 'success',
        startedAt,
        finishedAt,
        recordsFetched: prepared.records.length,
        recordsCreated: created,
        recordsUpdated: updated,
        errorMessage: null,
      }),
    );
    source.lastSyncAt = finishedAt;
    source.lastSyncStatus = 'success';
    source.lastSyncRecordCount = prepared.records.length;
    source.lastSyncError = null;
    await sources.save(source);
    await this.verifyApplied(
      manager,
      source,
      log,
      touched,
      fullReplaceDatasetId,
    );
    this.logger.log(
      `Sync completed for data source ${source.id}: ` +
        `${prepared.records.length} records`,
    );
    return {
      status: 'success',
      syncLogId: log.id,
      observation: {
        dataSourceId: source.id,
        datasetId: dataset?.id ?? null,
        syncLogId: log.id,
        recordsFetched: prepared.records.length,
        recordsCreated: created,
        recordsUpdated: updated,
        touchedRecordsHash: this.recordsHash(touched),
      },
    };
  }

  private newRecord(
    repository: Repository<DatasetRecordEntity>,
    datasetId: number,
    data: Record<string, any>,
  ): DatasetRecordEntity {
    return repository.create({
      dataset: { id: datasetId } as any,
      data,
      cellMetadata: {},
      sourceResourceId: null,
      extractionStatus: 'extracted',
      extractionError: null,
    }) as DatasetRecordEntity;
  }

  private async persistFailure(
    manager: EntityManager,
    source: DataSourceEntity,
    error: string,
    startedAt: Date,
  ): Promise<AppliedDataSourceSync> {
    const finishedAt = new Date();
    const logs = manager.getRepository(DataSourceSyncLogEntity);
    const log = await logs.save(
      logs.create({
        dataSource: { id: source.id } as any,
        status: 'failed',
        startedAt,
        finishedAt,
        recordsFetched: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        errorMessage: error,
      }),
    );
    source.lastSyncAt = finishedAt;
    source.lastSyncStatus = 'failed';
    source.lastSyncError = error;
    await manager.getRepository(DataSourceEntity).save(source);
    await this.verifyApplied(manager, source, log, [], null);
    return {
      status: 'failed',
      syncLogId: log.id,
      observation: {
        dataSourceId: source.id,
        datasetId: source.dataset?.id ?? null,
        syncLogId: log.id,
        errorHash: contentHash(error),
      },
    };
  }

  private async verifyApplied(
    manager: EntityManager,
    source: DataSourceEntity,
    log: DataSourceSyncLogEntity,
    touched: DatasetRecordEntity[],
    fullReplaceDatasetId: number | null,
  ): Promise<void> {
    const observedSource = await manager
      .getRepository(DataSourceEntity)
      .findOne({ where: { id: source.id }, relations: ['dataset'] });
    const observedLog = await manager
      .getRepository(DataSourceSyncLogEntity)
      .findOneBy({ id: log.id });
    if (
      observedSource?.lastSyncStatus !== source.lastSyncStatus ||
      observedSource.lastSyncError !== source.lastSyncError ||
      observedSource.lastSyncRecordCount !== source.lastSyncRecordCount ||
      observedSource.dataset?.id !== source.dataset?.id ||
      observedLog?.status !== log.status ||
      observedLog.recordsFetched !== log.recordsFetched ||
      observedLog.recordsCreated !== log.recordsCreated ||
      observedLog.recordsUpdated !== log.recordsUpdated ||
      observedLog.errorMessage !== log.errorMessage
    ) {
      throw new Error('data_source_sync_effect_not_verified');
    }
    if (!touched.length) return;
    const observedRecords = fullReplaceDatasetId
      ? await manager.getRepository(DatasetRecordEntity).find({
          where: { dataset: { id: fullReplaceDatasetId } },
        })
      : await manager
          .getRepository(DatasetRecordEntity)
          .findBy({ id: In(touched.map((record) => record.id)) });
    const expected = touched
      .map((record) => ({ id: record.id, data: record.data }))
      .sort((left, right) => left.id - right.id);
    const observed = observedRecords
      .map((record) => ({ id: record.id, data: record.data }))
      .sort((left, right) => left.id - right.id);
    if (!isDeepStrictEqual(observed, expected)) {
      throw new Error('data_source_sync_records_not_verified');
    }
  }

  private sourceIdentityHash(source: DataSourceEntity): string {
    return canonicalDomainHash({
      providerType: source.providerType,
      config: source.config,
      schemaMapping: source.schemaMapping,
      syncStrategy: source.syncStrategy,
      incrementalKey: source.incrementalKey,
      datasetId: source.dataset?.id ?? null,
      projectId: source.project?.id ?? null,
    });
  }

  private recordsHash(records: DatasetRecordEntity[]): string {
    return canonicalDomainHash(
      records
        .map((record) => ({ id: record.id, data: record.data }))
        .sort((left, right) => left.id - right.id),
    );
  }

  private applyMapping(
    records: Record<string, any>[],
    mapping: FieldMapping[] | null,
  ): Record<string, any>[] {
    if (!mapping?.length) return records;
    return records.map((record) => {
      const mapped: Record<string, any> = {};
      for (const field of mapping) {
        let value = field.sourceField
          .split('.')
          .reduce((current, key) => current?.[key], record);
        if (value != null) value = this.transform(value, field.transform);
        mapped[field.targetFieldKey] = value;
      }
      return mapped;
    });
  }

  private transform(value: any, transform?: string): any {
    if (transform === 'to_number') return Number(value) || 0;
    if (transform === 'to_date') {
      return new Date(value).toISOString().split('T')[0];
    }
    if (transform === 'to_boolean') return Boolean(value);
    if (transform === 'uppercase') return String(value).toUpperCase();
    if (transform === 'lowercase') return String(value).toLowerCase();
    if (transform === 'trim') return String(value).trim();
    return value;
  }

  private inferSchema(records: Record<string, any>[]): DatasetField[] {
    if (!records.length) return [];
    return Object.keys(records[0]).map((key) => {
      const sample = records
        .slice(0, 100)
        .map((record) => record[key])
        .filter((value) => value != null && value !== '');
      let type: DatasetField['type'] = 'text';
      if (
        sample.length &&
        sample.every(
          (value) =>
            typeof value === 'boolean' || value === 'true' || value === 'false',
        )
      ) {
        type = 'boolean';
      } else if (
        sample.length &&
        sample.every(
          (value) =>
            typeof value === 'number' ||
            (!Number.isNaN(Number(value)) && String(value).trim() !== ''),
        )
      ) {
        type = 'number';
      } else if (
        sample.length &&
        sample.every(
          (value) =>
            /^\d{4}-\d{2}-\d{2}/.test(String(value)) &&
            !Number.isNaN(Date.parse(String(value))),
        )
      ) {
        type = 'date';
      }
      return {
        key: key
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, ''),
        name: key,
        type,
        required: false,
      };
    });
  }
}
