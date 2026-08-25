import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DatasetEntity, DatasetField } from './dataset.entity';
import { DatasetRecordEntity } from './dataset-record.entity';
import { CellAnchor } from './cell-anchor.type';
import { ResourceService } from '../resource/resource.service';
import { ResourceEntity } from '../resource/resource.entity';
import { ExecutionService } from '../execution/execution.service';
import { ExecutionPriority } from '../execution/execution-priority.enum';

const DEFAULT_MODEL = 'Qwen3-8B-Q5_K_M.gguf';
const DEFAULT_PROMPT_VERSION = 'v1-2026-05';

@Injectable()
export class DatasetExtractionService {
  private readonly logger = new Logger(DatasetExtractionService.name);

  constructor(
    @InjectRepository(DatasetEntity)
    private readonly datasetRepository: Repository<DatasetEntity>,
    @InjectRepository(DatasetRecordEntity)
    private readonly recordRepository: Repository<DatasetRecordEntity>,
    private readonly resourceService: ResourceService,
    private readonly executionService: ExecutionService,
  ) {}

  async extractAll(datasetId: number): Promise<{ rowsQueued: number }> {
    const dataset = await this.datasetRepository.findOne({
      where: { id: datasetId },
      relations: ['project'],
    });
    if (!dataset) {
      throw new NotFoundException(`Dataset with id ${datasetId} not found`);
    }
    if (dataset.sourceMode === 'manual') {
      throw new BadRequestException('Cannot extract from a manual dataset');
    }

    const projectId = dataset.project?.id ?? null;
    const resources = await this.resolveSources(dataset, projectId);
    if (!resources.length) {
      return { rowsQueued: 0 };
    }

    const columnsToExtract = dataset.schema
      .filter((f) => f.description && f.description.trim().length > 0)
      .map((f) => f.key);

    let queued = 0;
    for (const resource of resources) {
      const record = await this.upsertRow(datasetId, resource.id);
      const execution = await this.enqueueExtractionExecution(
        dataset,
        record,
        resource,
        columnsToExtract,
        projectId,
      );
      if (execution) queued += 1;
    }

    dataset.extractionConfig = {
      model: dataset.extractionConfig?.model ?? DEFAULT_MODEL,
      promptVersion: DEFAULT_PROMPT_VERSION,
      lastRunAt: new Date().toISOString(),
    };
    await this.datasetRepository.save(dataset);

    return { rowsQueued: queued };
  }

  async extractRow(
    datasetId: number,
    recordId: number,
    columnsToExtract?: string[],
  ): Promise<{ executionId: string | null }> {
    const { dataset, record, resource } = await this.loadRowContext(
      datasetId,
      recordId,
    );
    const columns =
      columnsToExtract && columnsToExtract.length > 0
        ? columnsToExtract
        : dataset.schema
            .filter((f) => f.description && f.description.trim().length > 0)
            .map((f) => f.key);

    record.extractionStatus = 'in_progress';
    record.extractionError = null;
    await this.recordRepository.save(record);

    const execution = await this.enqueueExtractionExecution(
      dataset,
      record,
      resource,
      columns,
      dataset.project?.id ?? null,
    );
    return { executionId: execution?.executionId ?? null };
  }

  async extractCell(
    datasetId: number,
    recordId: number,
    fieldKey: string,
    options: { force?: boolean } = {},
  ): Promise<
    | { executionId: string | null }
    | { requiresConfirmation: true; reason: string }
  > {
    const { dataset, record, resource } = await this.loadRowContext(
      datasetId,
      recordId,
    );

    if (!dataset.schema.some((f) => f.key === fieldKey)) {
      throw new BadRequestException(
        `Field '${fieldKey}' is not in the dataset schema`,
      );
    }

    const currentAnchor = record.cellMetadata?.[fieldKey];
    if (currentAnchor?.editedByUser && !options.force) {
      return { requiresConfirmation: true, reason: 'cell_edited_by_user' };
    }

    // Leave row status as-is; UI shows a per-cell spinner. Processor merges.
    const execution = await this.enqueueExtractionExecution(
      dataset,
      record,
      resource,
      [fieldKey],
      dataset.project?.id ?? null,
    );
    return { executionId: execution?.executionId ?? null };
  }

  async proposeColumns(
    resourceIds: number[],
    projectId?: number,
  ): Promise<{ executionId: string | null }> {
    if (
      !resourceIds ||
      !Array.isArray(resourceIds) ||
      resourceIds.length === 0
    ) {
      throw new HttpException(
        'resourceIds is required and must be non-empty',
        HttpStatus.BAD_REQUEST,
      );
    }
    // Pull excerpts (max 3 resources, first ~2000 chars each) — backend
    // does the IO so the worker stays a pure LLM call.
    const slice = resourceIds.slice(0, 3);
    const excerpts = [] as Array<{
      id: number;
      title: string;
      excerpt: string;
    }>;
    for (const rid of slice) {
      const meta = await this.resourceService.findOne(rid);
      if (!meta) continue;
      const content = await this.resourceService.getContentById(rid);
      const text = (content ?? '').slice(0, 2000);
      excerpts.push({
        id: rid,
        title: meta.title || meta.name || `resource ${rid}`,
        excerpt: text,
      });
    }
    if (excerpts.length === 0 || excerpts.every((e) => !e.excerpt.trim())) {
      throw new HttpException(
        'no readable content in any of the given resources',
        HttpStatus.BAD_REQUEST,
      );
    }
    const execution = await this.executionService.createInference(
      'dataset.propose-columns',
      ExecutionPriority.NORMAL,
      {
        projectId: projectId ?? null,
        resources: excerpts,
      },
    );
    return { executionId: execution?.executionId ?? null };
  }

  private async loadRowContext(
    datasetId: number,
    recordId: number,
  ): Promise<{
    dataset: DatasetEntity;
    record: DatasetRecordEntity;
    resource: ResourceEntity;
  }> {
    const dataset = await this.datasetRepository.findOne({
      where: { id: datasetId },
      relations: ['project'],
    });
    if (!dataset) {
      throw new NotFoundException(`Dataset with id ${datasetId} not found`);
    }

    const record = await this.recordRepository.findOne({
      where: { id: recordId, dataset: { id: datasetId } },
    });
    if (!record) {
      throw new NotFoundException(`Record with id ${recordId} not found`);
    }
    if (record.sourceResourceId == null) {
      throw new BadRequestException('Cannot re-extract a manually created row');
    }

    const resource = await this.resourceService.findOne(
      record.sourceResourceId,
    );
    if (!resource) {
      throw new NotFoundException(
        `Resource with id ${record.sourceResourceId} not found`,
      );
    }

    return { dataset, record, resource };
  }

  private async resolveSources(
    dataset: DatasetEntity,
    projectId: number | null,
  ): Promise<ResourceEntity[]> {
    if (dataset.sourceMode === 'project_resources') {
      if (!projectId) {
        throw new BadRequestException(
          "sourceMode 'project_resources' requires the dataset to belong to a project",
        );
      }
      const all = await this.resourceService.findByProject(projectId);
      const filter: string[] | undefined =
        dataset.sourceConfig?.resourceTypeFilter;
      if (filter && filter.length > 0) {
        const wanted = new Set(filter);
        return all.filter((r) => r.mimeType && wanted.has(r.mimeType));
      }
      return all;
    }

    if (dataset.sourceMode === 'resource_selection') {
      const ids: number[] = dataset.sourceConfig?.resourceIds ?? [];
      if (ids.length === 0) return [];
      const resources = await Promise.all(
        ids.map((id) => this.resourceService.findOne(id)),
      );
      const found: ResourceEntity[] = [];
      for (const r of resources) {
        if (!r) {
          throw new BadRequestException(
            'One or more selected resources do not exist',
          );
        }
        if (projectId != null && r.project?.id !== projectId) {
          throw new BadRequestException(
            `Resource ${r.id} does not belong to the dataset's project`,
          );
        }
        found.push(r);
      }
      return found;
    }

    return [];
  }

  private async upsertRow(
    datasetId: number,
    resourceId: number,
  ): Promise<DatasetRecordEntity> {
    const existing = await this.recordRepository.findOne({
      where: { dataset: { id: datasetId }, sourceResourceId: resourceId },
    });
    if (existing) {
      existing.extractionStatus = 'in_progress';
      existing.extractionError = null;
      return await this.recordRepository.save(existing);
    }

    const created = this.recordRepository.create({
      dataset: { id: datasetId } as any,
      data: {},
      cellMetadata: {},
      sourceResourceId: resourceId,
      extractionStatus: 'in_progress',
      extractionError: null,
    });
    return await this.recordRepository.save(created);
  }

  private async enqueueExtractionExecution(
    dataset: DatasetEntity,
    record: DatasetRecordEntity,
    resource: ResourceEntity,
    columnsToExtract: string[],
    projectId: number | null,
  ) {
    const content = await this.resourceService.getContentById(resource.id);
    const isAudio = (resource.mimeType ?? '').startsWith('audio/');
    const fieldsForPayload: DatasetField[] = dataset.schema.filter(
      (f) => f.description && f.description.trim().length > 0,
    );

    const payload = {
      datasetId: dataset.id,
      recordId: record.id,
      resourceId: resource.id,
      projectId,
      schema: fieldsForPayload,
      columnsToExtract,
      documentText: content ?? '',
      sourceTitle: resource.title ?? resource.name ?? '',
      isAudio,
      model: dataset.extractionConfig?.model ?? DEFAULT_MODEL,
    };

    return await this.executionService.createInference(
      'dataset.extract-row',
      ExecutionPriority.NORMAL,
      payload,
      { finalizeOnFailure: true },
    );
  }

  /**
   * Apply a completed worker result onto the target record.
   *
   * Called by the processor (see `DatasetExtractionProcessor`).
   * Honours the "skip editedByUser cell" invariant — manual edits win
   * over extraction unless the user explicitly forced a re-extract.
   */
  async applyExtractionResult(
    recordId: number,
    result: {
      data: Record<string, any>;
      cellMetadata: Record<string, CellAnchor>;
      model?: string;
      promptVersion?: string;
    },
    columnsExtracted: string[],
  ): Promise<{ datasetId: number; status: 'extracted' }> {
    const record = await this.recordRepository.findOne({
      where: { id: recordId },
      relations: ['dataset'],
    });
    if (!record) {
      throw new NotFoundException(`Record with id ${recordId} not found`);
    }

    const data = { ...(record.data || {}) };
    const cellMetadata = { ...(record.cellMetadata || {}) };
    const incomingData = result.data;
    const incomingAnchors = result.cellMetadata;

    for (const fieldKey of columnsExtracted) {
      const currentAnchor = cellMetadata[fieldKey];
      if (currentAnchor?.editedByUser) {
        this.logger.log(
          `dataset.extract-row: skipped editedByUser cell '${fieldKey}' on record ${recordId}`,
        );
        continue;
      }
      if (!(fieldKey in incomingData)) continue;

      const newValue = incomingData[fieldKey];
      data[fieldKey] = newValue;

      if (newValue === null || newValue === undefined) {
        delete cellMetadata[fieldKey];
      } else if (incomingAnchors[fieldKey]) {
        cellMetadata[fieldKey] = incomingAnchors[fieldKey];
      }
    }

    record.data = data;
    record.cellMetadata = cellMetadata;
    record.extractionStatus = 'extracted';
    record.extractionError = null;
    await this.recordRepository.save(record);

    return { datasetId: record.dataset.id, status: 'extracted' };
  }

  async markExtractionFailed(
    recordId: number,
    message: string,
  ): Promise<{ datasetId: number; status: 'failed' }> {
    const record = await this.recordRepository.findOne({
      where: { id: recordId },
      relations: ['dataset'],
    });
    if (!record) {
      throw new NotFoundException(`Record with id ${recordId} not found`);
    }

    record.extractionStatus = 'failed';
    record.extractionError = message;
    await this.recordRepository.save(record);
    return { datasetId: record.dataset.id, status: 'failed' };
  }
}
