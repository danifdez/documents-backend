import { Injectable } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { ExecutionEffectJournalService } from '../../execution/execution-effect-journal.service';
import { ResourceEntity } from '../../resource/resource.entity';
import { canonicalHash } from '../../execution/execution-canonical';

class KeyPointsResourceNotFoundError extends Error {}

@Injectable()
export class KeyPointsProcessor implements ExecutionProcessor {
  private readonly TASK_TYPE = 'key-point';

  constructor(private readonly effectJournal: ExecutionEffectJournalService) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = Number(execution.payload['resourceId']);
    const result = execution.result as { key_points?: unknown };
    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      throw new Error('Key-point execution requires a valid resourceId');
    }
    if (
      !result ||
      !Array.isArray(result.key_points) ||
      result.key_points.some((point) => typeof point !== 'string')
    ) {
      throw new Error('Key-point execution returned an invalid result');
    }

    const keyPoints = result.key_points as string[];
    try {
      await this.effectJournal.runVerified(
        {
          executionId: execution.executionId,
          effectKey: `key-points-resource-replace:${resourceId}`,
          effectType: 'resource_key_points_replace',
          resourceKey: `resource:${resourceId}`,
          intent: { resourceId, keyPoints },
        },
        async (manager) => {
          const repository = manager.getRepository(ResourceEntity);
          const resource = await repository.findOne({
            where: { id: resourceId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!resource) throw new KeyPointsResourceNotFoundError();
          const before = resource.keyPoints;
          resource.keyPoints = keyPoints;
          await repository.save(resource);
          const observed = await repository.findOneBy({ id: resourceId });
          if (
            !observed ||
            canonicalHash(observed.keyPoints) !== canonicalHash(keyPoints)
          ) {
            throw new Error('resource_key_points_effect_not_verified');
          }
          return {
            resourceId,
            beforeKeyPointsHash: canonicalHash(before),
            afterKeyPointsHash: canonicalHash(keyPoints),
          };
        },
      );
    } catch (error) {
      if (!(error instanceof KeyPointsResourceNotFoundError)) throw error;
      return {
        success: false,
        message: `Target resource ${resourceId} not found`,
      };
    }

    return {
      success: true,
      message: 'Key points processed',
      publication: {
        socketEvent: 'notification',
        payload: {
          type: 'key-points',
          message: `Key points extracted for resource ${resourceId}`,
          resourceId,
        },
      },
    };
  }
}
