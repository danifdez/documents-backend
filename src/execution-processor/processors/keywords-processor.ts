import { Injectable } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { ExecutionEffectJournalService } from '../../execution/execution-effect-journal.service';
import { ResourceEntity } from '../../resource/resource.entity';
import { canonicalHash } from '../../execution/execution-canonical';

class KeywordsResourceNotFoundError extends Error {}

@Injectable()
export class KeywordsProcessor implements ExecutionProcessor {
  private readonly TASK_TYPE = 'keywords';

  constructor(private readonly effectJournal: ExecutionEffectJournalService) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = Number(execution.payload['resourceId']);
    const result = execution.result as { keywords?: unknown };
    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      throw new Error('Keywords execution requires a valid resourceId');
    }
    if (
      !result ||
      !Array.isArray(result.keywords) ||
      result.keywords.some((keyword) => typeof keyword !== 'string')
    ) {
      throw new Error('Keywords execution returned an invalid result');
    }

    const keywords = result.keywords as string[];
    try {
      await this.effectJournal.runVerified(
        {
          executionId: execution.executionId,
          effectKey: `keywords-resource-replace:${resourceId}`,
          effectType: 'resource_keywords_replace',
          resourceKey: `resource:${resourceId}`,
          intent: { resourceId, keywords },
        },
        async (manager) => {
          const repository = manager.getRepository(ResourceEntity);
          const resource = await repository.findOne({
            where: { id: resourceId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!resource) throw new KeywordsResourceNotFoundError();
          const before = resource.keywords;
          resource.keywords = keywords;
          await repository.save(resource);
          const observed = await repository.findOneBy({ id: resourceId });
          if (
            !observed ||
            canonicalHash(observed.keywords) !== canonicalHash(keywords)
          ) {
            throw new Error('resource_keywords_effect_not_verified');
          }
          return {
            resourceId,
            beforeKeywordsHash: canonicalHash(before),
            afterKeywordsHash: canonicalHash(keywords),
          };
        },
      );
    } catch (error) {
      if (!(error instanceof KeywordsResourceNotFoundError)) throw error;
      return {
        success: false,
        message: `Target resource ${resourceId} not found`,
      };
    }

    return {
      success: true,
      message: 'Keywords processed',
      publication: {
        socketEvent: 'notification',
        payload: {
          type: 'keywords',
          message: `Keywords extracted for resource ${resourceId}`,
          resourceId,
        },
      },
    };
  }
}
