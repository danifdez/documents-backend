import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ExecutionPriority } from '../execution/execution-priority.enum';
import { ExecutionService } from '../execution/execution.service';
import { DatasetRecordEntity } from './dataset-record.entity';
import { DatasetEntity, DatasetField } from './dataset.entity';
import { isDatasetAnalysisTaskType } from './dataset-analysis.types';

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
    @InjectRepository(DatasetEntity)
    private readonly datasetRepository: Repository<DatasetEntity>,
    @InjectRepository(DatasetRecordEntity)
    private readonly recordRepository: Repository<DatasetRecordEntity>,
    private readonly executionService: ExecutionService,
  ) {}

  async createExecution(
    operation: string,
    datasetIds: number[],
    params: Record<string, unknown>,
  ) {
    if (!isDatasetAnalysisTaskType(operation)) {
      throw new BadRequestException('Unsupported dataset analysis operation');
    }
    const ids = [...new Set(datasetIds.map(Number))].filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    if (!ids.length) {
      throw new BadRequestException('At least one dataset is required');
    }
    const snapshots = await this.buildSnapshots(ids);
    const payload = {
      ...(ids.length === 1 ? { datasetId: ids[0] } : { datasetIds: ids }),
      params,
    };
    return this.executionService.createCode(
      operation,
      ExecutionPriority.NORMAL,
      payload,
      {
        inputArtifacts: [
          {
            role: 'datasets',
            kind: 'dataset_snapshot',
            mediaType: 'application/json',
            body: Buffer.from(
              JSON.stringify({
                schemaVersion: 'dataset-analysis-input/1',
                datasets: snapshots,
              }),
            ),
          },
        ],
      },
    );
  }

  private async buildSnapshots(
    datasetIds: number[],
  ): Promise<DatasetAnalysisSnapshot[]> {
    const datasets = await this.datasetRepository.find({
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
          await this.recordRepository.find({
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
