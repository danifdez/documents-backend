import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { ExecutionPriority } from '../execution/execution-priority.enum';
import { CreateExecutionOptions, ExecutionService } from '../execution/execution.service';
import { ExecutionAccessScope } from '../execution/execution.types';
import { DatasetRecordEntity } from './dataset-record.entity';
import { DatasetEntity, DatasetField } from './dataset.entity';
import { parseDatasetAnalysisRequest } from './dataset-analysis-request';

interface DatasetAnalysisField extends DatasetField {
  linkedLabels?: Record<string, string>;
}

interface DatasetAnalysisSnapshot {
  datasetId: number;
  schema: DatasetAnalysisField[];
  records: Array<{ id: number; data: Record<string, unknown> }>;
}

@Injectable()
export class DatasetAnalysisService {
  constructor(
    private readonly executionService: ExecutionService,
  ) {}

  async createExecution(
    operation: unknown,
    datasetIds: number[],
    params: unknown,
    scope: ExecutionAccessScope,
    requestId?: string,
  ) {
    const request = parseDatasetAnalysisRequest(operation, params, 'summary');
    const ids = [...new Set(datasetIds.map(Number))].filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    if (!ids.length) {
      throw new BadRequestException('At least one dataset is required');
    }
    if (request.operation !== 'query' && ids.length !== 1) {
      throw new BadRequestException(
        'Only dataset query supports multiple datasets',
      );
    }
    const options: CreateExecutionOptions = {
      ownerPrincipal: scope.ownerPrincipal,
      requestId,
      snapshotArtifacts: async (manager) => [
        {
          role: 'datasets',
          kind: 'dataset_snapshot',
          mediaType: 'application/json',
          body: Buffer.from(
            JSON.stringify({
              schemaVersion: 'dataset-analysis-input/1',
              datasets: await this.buildSnapshots(manager, ids),
            }),
          ),
        },
      ],
    };
    switch (request.operation) {
      case 'distribution':
        return this.executionService.createCode(
          request.operation,
          ExecutionPriority.NORMAL,
          { datasetId: ids[0], params: request.params },
          options,
        );
      case 'correlation':
        return this.executionService.createCode(
          request.operation,
          ExecutionPriority.NORMAL,
          { datasetId: ids[0], params: request.params },
          options,
        );
      case 'correlation-matrix':
        return this.executionService.createCode(
          request.operation,
          ExecutionPriority.NORMAL,
          { datasetId: ids[0], params: request.params },
          options,
        );
      case 'group-by':
        return this.executionService.createCode(
          request.operation,
          ExecutionPriority.NORMAL,
          { datasetId: ids[0], params: request.params },
          options,
        );
      case 'time-series':
        return this.executionService.createCode(
          request.operation,
          ExecutionPriority.NORMAL,
          { datasetId: ids[0], params: request.params },
          options,
        );
      case 'outliers':
        return this.executionService.createCode(
          request.operation,
          ExecutionPriority.NORMAL,
          { datasetId: ids[0], params: request.params },
          options,
        );
      case 'pivot-table':
        return this.executionService.createCode(
          request.operation,
          ExecutionPriority.NORMAL,
          { datasetId: ids[0], params: request.params },
          options,
        );
      case 'summary':
        return this.executionService.createCode(
          request.operation,
          ExecutionPriority.NORMAL,
          { datasetId: ids[0], params: request.params },
          options,
        );
      case 'query':
        return this.executionService.createCode(
          request.operation,
          ExecutionPriority.NORMAL,
          {
            ...(ids.length === 1 ? { datasetId: ids[0] } : { datasetIds: ids }),
            params: request.params,
          },
          options,
        );
      case 'chart':
        return this.executionService.createCode(
          request.operation,
          ExecutionPriority.NORMAL,
          { datasetId: ids[0], params: request.params },
          options,
        );
    }
  }

  private async buildSnapshots(
    manager: EntityManager,
    datasetIds: number[],
  ): Promise<DatasetAnalysisSnapshot[]> {
    const datasets = await manager.getRepository(DatasetEntity).find({
      where: { id: In(datasetIds) },
    });
    const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
    const missing = datasetIds.find((id) => !byId.has(id));
    if (missing !== undefined) {
      throw new NotFoundException(`Dataset with id ${missing} not found`);
    }
    const records = new Map<number, DatasetRecordEntity[]>();
    const loadRecords = async (datasetId: number) => {
      if (!records.has(datasetId)) {
        records.set(
          datasetId,
          await manager.getRepository(DatasetRecordEntity).find({
            where: { dataset: { id: datasetId } },
            select: ['id', 'data'],
          }),
        );
      }
      return records.get(datasetId)!;
    };

    const snapshots: DatasetAnalysisSnapshot[] = [];
    for (const datasetId of datasetIds) {
      const dataset = byId.get(datasetId)!;
      const datasetRecords = await loadRecords(datasetId);
      const schema: DatasetAnalysisField[] = [];
      for (const field of dataset.schema) {
        const copy: DatasetAnalysisField = { ...field };
        if (field.linkedDatasetId) {
          copy.linkedLabels = this.buildLinkedLabels(
            await loadRecords(field.linkedDatasetId),
            field,
          );
        }
        schema.push(copy);
      }
      snapshots.push({
        datasetId,
        schema,
        records: datasetRecords.map((record) => ({
          id: record.id,
          data: record.data,
        })),
      });
    }
    return snapshots;
  }

  private buildLinkedLabels(
    records: DatasetRecordEntity[],
    field: DatasetField,
  ): Record<string, string> {
    const labels: Record<string, string> = {};
    for (const record of records) {
      const key = field.linkedLookupField
        ? record.data[field.linkedLookupField]
        : record.id;
      const display = field.linkedDisplayField
        ? record.data[field.linkedDisplayField]
        : Object.values(record.data).find(
            (value) => typeof value === 'string' && value.length > 0,
          );
      if (key !== null && key !== undefined && display !== undefined) {
        labels[String(key)] = String(display);
      }
    }
    return labels;
  }
}
