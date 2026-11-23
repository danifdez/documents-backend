import { forEachSequential } from '../utils/for-each-sequential';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DatasetEntity, DatasetField } from './dataset.entity';
import { DatasetRecordEntity } from './dataset-record.entity';
import { ResourceService } from '../resource/resource.service';
import { ResourceEntity } from '../resource/resource.entity';
import { ExecutionService } from '../execution/execution.service';
import { ExecutionPriority } from '../execution/execution-priority.enum';
import { buildDatasetExtractionWorkflowSteps } from './dataset-extraction-workflow';

const DEFAULT_MODEL = 'Qwen3-8B-Q5_K_M.gguf';
const DEFAULT_PROMPT_VERSION = 'v1-2026-05';

@Injectable()
export class DatasetExtractionService {
  constructor(
    @InjectRepository(DatasetEntity)
    private readonly datasetRepository: Repository<DatasetEntity>,
    @InjectRepository(DatasetRecordEntity)
    private readonly recordRepository: Repository<DatasetRecordEntity>,
    private readonly resourceService: ResourceService,
    private readonly executionService: ExecutionService,
  ) {}

  async extractAll(
    datasetId: number,
    ownerPrincipal: string,
    captureResourceId?: number,
  ): Promise<{ rowsQueued: number; executionIds: string[] }> {
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
    if (
      captureResourceId !== undefined &&
      !resources.some((resource) => resource.id === captureResourceId)
    ) {
      throw new BadRequestException(
        'Dataset source does not match the authorized resource',
      );
    }
    if (!resources.length) {
      return { rowsQueued: 0, executionIds: [] };
    }

    const columnsToExtract = dataset.schema
      .filter((f) => f.description && f.description.trim().length > 0)
      .map((f) => f.key);

    const executionIds: string[] = [];
    await forEachSequential(resources, async (resource) => {
      const record = await this.upsertRow(datasetId, resource.id);
      const execution = await this.enqueueExtractionExecution(
        dataset,
        record,
        resource,
        columnsToExtract,
        projectId,
        ownerPrincipal,
        captureResourceId !== undefined && resource.id === captureResourceId,
      );
      if (execution) executionIds.push(execution.executionId);
    });

    dataset.extractionConfig = {
      model: dataset.extractionConfig?.model ?? DEFAULT_MODEL,
      promptVersion: DEFAULT_PROMPT_VERSION,
      lastRunAt: new Date().toISOString(),
    };
    await this.datasetRepository.save(dataset);

    return { rowsQueued: executionIds.length, executionIds };
  }

  async extractRow(
    datasetId: number,
    recordId: number,
    ownerPrincipal: string,
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
      ownerPrincipal,
    );
    return { executionId: execution?.executionId ?? null };
  }

  async extractCell(
    datasetId: number,
    recordId: number,
    fieldKey: string,
    ownerPrincipal: string,
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
      ownerPrincipal,
    );
    return { executionId: execution?.executionId ?? null };
  }

  async proposeColumns(
    resourceIds: number[],
    ownerPrincipal: string,
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
    const fetched = await Promise.all(
      resourceIds.slice(0, 3).map(async (id) => {
        const meta = await this.resourceService.findOne(id);
        if (!meta) return null;
        const content = await this.resourceService.getContentById(id);
        return {
          id,
          title: meta.title || meta.name || `resource ${id}`,
          excerpt: (content ?? '').slice(0, 2000),
        };
      }),
    );
    const excerpts = fetched.filter((excerpt) => excerpt !== null);
    if (excerpts.every((excerpt) => !excerpt.excerpt.trim())) {
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
      { ownerPrincipal },
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
      return this.resolveSelectedResources(dataset, projectId);
    }
    return [];
  }

  private async resolveSelectedResources(
    dataset: DatasetEntity,
    projectId: number | null,
  ): Promise<ResourceEntity[]> {
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
    ownerPrincipal: string,
    captureInference = false,
  ) {
    const content = await this.resourceService.getContentById(resource.id);
    const mediaType = resource.mimeType?.split(';', 1)[0]?.trim().toLowerCase();
    const isAudio = mediaType?.startsWith('audio/') ?? false;
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
      ...(mediaType === 'text/html' && {
        sourcePagination: 'unpaginated' as const,
      }),
      model: dataset.extractionConfig?.model ?? DEFAULT_MODEL,
    };

    const steps = buildDatasetExtractionWorkflowSteps(payload);
    return await this.executionService.create(
      'dataset.extract-row',
      ExecutionPriority.NORMAL,
      payload,
      {
        steps,
        ownerPrincipal,
        ...(captureInference ? { captureInference } : {}),
      },
    );
  }
}
