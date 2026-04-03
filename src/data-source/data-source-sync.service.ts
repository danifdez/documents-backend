import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataSourceEntity, FieldMapping } from './data-source.entity';
import { DataSourceSyncLogEntity } from './data-source-sync-log.entity';
import { DataSourceProviderFactory } from './data-source-provider.factory';
import { DataSourceService } from './data-source.service';
import { DatasetService } from '../dataset/dataset.service';
import { DatasetField } from '../dataset/dataset.entity';
import { DatasetRecordEntity } from '../dataset/dataset-record.entity';

@Injectable()
export class DataSourceSyncService {
    private readonly logger = new Logger(DataSourceSyncService.name);

    constructor(
        @InjectRepository(DataSourceEntity)
        private readonly dsRepo: Repository<DataSourceEntity>,
        @InjectRepository(DataSourceSyncLogEntity)
        private readonly syncLogRepo: Repository<DataSourceSyncLogEntity>,
        @InjectRepository(DatasetRecordEntity)
        private readonly recordRepo: Repository<DatasetRecordEntity>,
        private readonly providerFactory: DataSourceProviderFactory,
        private readonly dataSourceService: DataSourceService,
        private readonly datasetService: DatasetService,
    ) {}

    async syncDataSource(dataSourceId: number): Promise<DataSourceSyncLogEntity> {
        const ds = await this.dataSourceService.findOne(dataSourceId);
        const provider = this.providerFactory.getProvider(ds.providerType);
        if (!provider) {
            return this.failSync(ds, `Unknown provider type: ${ds.providerType}`);
        }

        const credentials = this.dataSourceService.getDecryptedCredentials(ds);

        // Create sync log
        const syncLog = this.syncLogRepo.create({
            dataSource: { id: ds.id } as any,
            status: 'running',
            startedAt: new Date(),
            recordsFetched: 0,
            recordsCreated: 0,
            recordsUpdated: 0,
        });
        await this.syncLogRepo.save(syncLog);

        // Update data source status
        ds.lastSyncStatus = 'running';
        ds.lastSyncError = null;
        await this.dsRepo.save(ds);

        try {
            // Fetch all data with pagination
            const allRecords: Record<string, any>[] = [];
            let cursor: string | undefined;
            let hasMore = true;

            while (hasMore) {
                const result = await provider.fetch(ds.config, credentials ?? undefined, cursor);
                allRecords.push(...result.records);
                hasMore = result.hasMore ?? false;
                cursor = result.cursor;

                // Rate limiting
                if (hasMore && ds.rateLimitRpm) {
                    const delay = Math.ceil(60000 / ds.rateLimitRpm);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

            syncLog.recordsFetched = allRecords.length;

            if (allRecords.length === 0) {
                syncLog.status = 'success';
                syncLog.finishedAt = new Date();
                syncLog.recordsCreated = 0;
                await this.syncLogRepo.save(syncLog);
                ds.lastSyncAt = new Date();
                ds.lastSyncStatus = 'success';
                ds.lastSyncRecordCount = 0;
                await this.dsRepo.save(ds);
                return syncLog;
            }

            // Apply schema mapping
            const mappedRecords = this.applyMapping(allRecords, ds.schemaMapping);

            // Determine schema
            let schema: DatasetField[];
            if (ds.schemaMapping && ds.schemaMapping.length > 0) {
                schema = ds.schemaMapping.map(m => ({
                    key: m.targetFieldKey,
                    name: m.targetFieldName,
                    type: m.targetFieldType,
                    required: false,
                }));
            } else {
                schema = this.inferSchema(mappedRecords);
            }

            // Create or update dataset
            let datasetId: number;
            if (ds.dataset) {
                datasetId = ds.dataset.id;
            } else {
                const dataset = await this.datasetService.createDataset({
                    name: ds.name,
                    description: ds.description || `Data from ${ds.providerType}`,
                    schema,
                    projectId: ds.project?.id,
                });
                datasetId = dataset.id;
                ds.dataset = dataset;
                await this.dsRepo.save(ds);
            }

            // Sync records
            if (ds.syncStrategy === 'incremental' && ds.incrementalKey) {
                const result = await this.incrementalSync(datasetId, mappedRecords, ds.incrementalKey, schema);
                syncLog.recordsCreated = result.created;
                syncLog.recordsUpdated = result.updated;
            } else {
                // Full refresh: delete all existing records, insert new ones
                await this.recordRepo.delete({ dataset: { id: datasetId } });
                const result = await this.datasetService.bulkCreateRecords(datasetId, mappedRecords);
                syncLog.recordsCreated = result.imported;
            }

            syncLog.status = 'success';
            syncLog.finishedAt = new Date();
            await this.syncLogRepo.save(syncLog);

            ds.lastSyncAt = new Date();
            ds.lastSyncStatus = 'success';
            ds.lastSyncRecordCount = allRecords.length;
            ds.lastSyncError = null;
            await this.dsRepo.save(ds);

            this.logger.log(`Sync completed for data source ${ds.id} (${ds.name}): ${allRecords.length} records`);
            return syncLog;
        } catch (err) {
            syncLog.status = 'failed';
            syncLog.finishedAt = new Date();
            syncLog.errorMessage = err.message;
            await this.syncLogRepo.save(syncLog);

            ds.lastSyncAt = new Date();
            ds.lastSyncStatus = 'failed';
            ds.lastSyncError = err.message;
            await this.dsRepo.save(ds);

            this.logger.error(`Sync failed for data source ${ds.id}: ${err.message}`);
            return syncLog;
        }
    }

    private async failSync(ds: DataSourceEntity, error: string): Promise<DataSourceSyncLogEntity> {
        const syncLog = this.syncLogRepo.create({
            dataSource: { id: ds.id } as any,
            status: 'failed',
            startedAt: new Date(),
            finishedAt: new Date(),
            errorMessage: error,
        });
        await this.syncLogRepo.save(syncLog);

        ds.lastSyncStatus = 'failed';
        ds.lastSyncError = error;
        await this.dsRepo.save(ds);

        return syncLog;
    }

    private applyMapping(records: Record<string, any>[], mapping: FieldMapping[] | null): Record<string, any>[] {
        if (!mapping || mapping.length === 0) return records;

        return records.map(record => {
            const mapped: Record<string, any> = {};
            for (const m of mapping) {
                let value = this.getNestedValue(record, m.sourceField);
                value = this.applyTransform(value, m.transform);
                mapped[m.targetFieldKey] = value;
            }
            return mapped;
        });
    }

    private getNestedValue(obj: any, path: string): any {
        return path.split('.').reduce((curr, key) => curr?.[key], obj);
    }

    private applyTransform(value: any, transform?: string): any {
        if (value === null || value === undefined) return value;
        switch (transform) {
            case 'to_number': return Number(value) || 0;
            case 'to_date': return new Date(value).toISOString().split('T')[0];
            case 'to_boolean': return Boolean(value);
            case 'uppercase': return String(value).toUpperCase();
            case 'lowercase': return String(value).toLowerCase();
            case 'trim': return String(value).trim();
            default: return value;
        }
    }

    private inferSchema(records: Record<string, any>[]): DatasetField[] {
        if (records.length === 0) return [];

        const keys = Object.keys(records[0]);
        return keys.map(key => {
            const sample = records.slice(0, 100).map(r => r[key]).filter(v => v !== null && v !== undefined && v !== '');
            return {
                key: this.toFieldKey(key),
                name: key,
                type: this.detectType(sample),
                required: false,
            };
        });
    }

    private toFieldKey(name: string): string {
        return name
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '');
    }

    private detectType(values: any[]): DatasetField['type'] {
        if (values.length === 0) return 'text';
        const sample = values.slice(0, 100);

        if (sample.every(v => typeof v === 'boolean' || v === 'true' || v === 'false')) return 'boolean';
        if (sample.every(v => typeof v === 'number' || (!isNaN(Number(v)) && String(v).trim() !== ''))) return 'number';
        if (sample.every(v => /^\d{4}-\d{2}-\d{2}/.test(String(v)) && !isNaN(Date.parse(String(v))))) return 'date';

        return 'text';
    }

    private async incrementalSync(
        datasetId: number,
        newRecords: Record<string, any>[],
        incrementalKey: string,
        schema: DatasetField[],
    ): Promise<{ created: number; updated: number }> {
        const existing = await this.recordRepo.find({
            where: { dataset: { id: datasetId } },
        });

        const existingMap = new Map<string, DatasetRecordEntity>();
        for (const record of existing) {
            const key = String(record.data?.[incrementalKey] ?? '');
            if (key) existingMap.set(key, record);
        }

        let created = 0;
        let updated = 0;
        const toInsert: { dataset: any; data: Record<string, any> }[] = [];
        const toUpdate: DatasetRecordEntity[] = [];

        for (const record of newRecords) {
            const key = String(record[incrementalKey] ?? '');
            const existingRecord = key ? existingMap.get(key) : undefined;

            if (existingRecord) {
                existingRecord.data = record;
                toUpdate.push(existingRecord);
                updated++;
            } else {
                toInsert.push({
                    dataset: { id: datasetId } as any,
                    data: record,
                });
                created++;
            }
        }

        if (toUpdate.length > 0) {
            await this.recordRepo.save(toUpdate, { chunk: 100 });
        }
        if (toInsert.length > 0) {
            await this.recordRepo.save(
                toInsert.map(r => this.recordRepo.create(r)),
                { chunk: 100 },
            );
        }

        return { created, updated };
    }
}
