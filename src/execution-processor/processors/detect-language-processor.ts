import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ResourceService } from '../../resource/resource.service';
import { ResourceEntity } from '../../resource/resource.entity';
import { ExecutionService } from '../../execution/execution.service';
import { ExecutionPriority } from '../../execution/execution-priority.enum';
import { ExecutionEntity } from '../../execution/execution.entity';
import { extractTextFromHtml } from '../../utils/text';
import { buildDateExtractionWorkflowSteps } from '../../model/date-extraction-workflow';
import { ExecutionEffectJournalService } from '../../execution/execution-effect-journal.service';
import { contentHash } from '../../execution/execution-canonical';

class DetectLanguageResourceNotFoundError extends Error {}
class DetectLanguageResourceChangedError extends Error {}

@Injectable()
export class DetectLanguageProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(DetectLanguageProcessor.name);
  private readonly TASK_TYPE = 'detect-language';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly executionService: ExecutionService,
    private readonly effectJournal: ExecutionEffectJournalService,
  ) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = Number(execution.payload['resourceId']) as number;
    const result = execution.result as {
      results?: Array<{ language?: unknown }>;
    } | null;
    const results = result?.results;
    if (
      !Array.isArray(results) ||
      results.length < 2 ||
      results.some((item) => typeof item?.language !== 'string')
    ) {
      throw new Error('detect-language result is invalid');
    }

    if (
      results[0].language !== 'unknown' &&
      results[0].language === results[1].language
    ) {
      const detectedLanguage = String(results[0].language);
      const resource = await this.resourceService.findOne(resourceId);
      const content = await this.resourceService.getContentById(resourceId);
      if (!resource) return { success: false, reason: 'not_found' };
      const projectId = (resource?.project as any)?.id || null;
      const sourceContentHash = contentHash(content ?? '');

      try {
        await this.effectJournal.runVerified(
          {
            executionId: execution.executionId,
            effectKey: `detect-language:${resourceId}`,
            effectType: 'resource_language_replace',
            resourceKey: `resource:${resourceId}`,
            intent: {
              resourceId,
              detectedLanguage,
              sourceContentHash,
              status: 'ready',
            },
          },
          async (manager) => {
            const repository = manager.getRepository(ResourceEntity);
            const current = await repository.findOne({
              where: { id: resourceId },
              lock: { mode: 'pessimistic_write' },
            });
            if (!current) throw new DetectLanguageResourceNotFoundError();
            if (contentHash(current.content ?? '') !== sourceContentHash) {
              throw new DetectLanguageResourceChangedError();
            }
            const beforeLanguage = current.language;
            const beforeStatus = current.status;
            current.language = detectedLanguage;
            current.status = 'ready';
            await repository.save(current);
            const observed = await repository.findOneBy({ id: resourceId });
            if (
              observed?.language !== detectedLanguage ||
              observed.status !== 'ready'
            ) {
              throw new Error('detect_language_effect_not_verified');
            }
            return {
              resourceId,
              beforeLanguage,
              afterLanguage: detectedLanguage,
              beforeStatus,
              afterStatus: 'ready',
              sourceContentHash,
            };
          },
        );
      } catch (error) {
        if (error instanceof DetectLanguageResourceNotFoundError) {
          return { success: false, reason: 'not_found' };
        }
        if (error instanceof DetectLanguageResourceChangedError) {
          return { success: false, reason: 'stale' };
        }
        throw error;
      }

      if (!content) return { success: true, resourceId, detectedLanguage };
      if (!execution.lastEventId) {
        throw new Error('Detect-language execution has no causal event');
      }

      const ingestPayload = {
        resourceId,
        projectId,
        content,
      };
      await this.executionService.createChildInferenceOnce(
        execution.executionId,
        `detect-language:ingest-content:${resourceId}:${sourceContentHash}`,
        {
          taskType: 'ingest-content',
          payload: ingestPayload,
          work: { taskType: 'ingest-content', payload: ingestPayload },
          requiredCapability: 'ingest-content',
          causedByEventId: execution.lastEventId,
        },
      );

      const anchorDate = resource?.publicationDate
        ? String(resource.publicationDate).slice(0, 10)
        : null;
      const dateSteps = buildDateExtractionWorkflowSteps(
        extractTextFromHtml(content),
        detectedLanguage,
        anchorDate,
      );
      await this.executionService.create(
        'date-extraction',
        ExecutionPriority.NORMAL,
        {
          resourceId,
          sourceContentHash,
          detectedLanguage,
          anchorDate,
        },
        {
          rootExecutionId: execution.rootExecutionId,
          parentExecutionId: execution.executionId,
          childIdempotencyKey:
            `detect-language:date-extraction:${resourceId}:` +
            sourceContentHash,
          steps: dateSteps,
        },
      );
      return { success: true, resourceId, detectedLanguage };
    }
    return { success: false, reason: 'inconclusive' };
  }
}
