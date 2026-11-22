import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { ExecutionPriority } from '../execution/execution-priority.enum';
import {
  CreateExecutionOptions,
  ExecutionService,
} from '../execution/execution.service';
import { ExecutionAccessScope } from '../execution/execution.types';
import type { ExecutionTaskPayload } from '../execution/execution-task-payload.types';
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
  constructor(private readonly executionService: ExecutionService) {}

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
    if (request.operation === 'query') {
      return this.executionService.createCode(
        request.operation,
        ExecutionPriority.NORMAL,
        {
          ...(ids.length === 1 ? { datasetId: ids[0] } : { datasetIds: ids }),
          params: request.params,
        },
        options,
      );
    }
    return this.executionService.createCode(
      request.operation,
      ExecutionPriority.NORMAL,
      // The parsed request pairs the operation with its validated parameter type.
      { datasetId: ids[0], params: request.params } as ExecutionTaskPayload<
        typeof request.operation
      >,
      options,
    );
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
    const recordDatasetIds = new Set(datasetIds);
    for (const dataset of datasets) {
      for (const field of dataset.schema) {
        if (field.linkedDatasetId) recordDatasetIds.add(field.linkedDatasetId);
      }
    }
    const records = await manager.getRepository(DatasetRecordEntity).find({
      where: { dataset: { id: In([...recordDatasetIds]) } },
      relations: { dataset: true },
      select: { id: true, data: true, dataset: { id: true } },
      order: { id: 'ASC' },
    });
    const recordsByDataset = new Map<number, DatasetRecordEntity[]>();
    for (const record of records) {
      const id = record.dataset.id;
      const existing = recordsByDataset.get(id);
      if (existing) existing.push(record);
      else recordsByDataset.set(id, [record]);
    }
    return datasetIds.map((datasetId) => {
      const dataset = byId.get(datasetId)!;
      return {
        datasetId,
        schema: dataset.schema.map((field) => {
          if (!field.linkedDatasetId) return field;
          const linkedRecords =
            recordsByDataset.get(field.linkedDatasetId) ?? [];
          return {
            ...field,
            linkedLabels: this.buildLinkedLabels(linkedRecords, field),
          };
        }),
        records: (recordsByDataset.get(datasetId) ?? []).map(
          ({ id, data }) => ({ id, data }),
        ),
      };
    });
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
