import { Injectable } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { ResourceDatePayload } from '../../resource-date/dto/resource-date.dto';
import { ExecutionEffectJournalService } from '../../execution/execution-effect-journal.service';
import { ResourceDateEntity } from '../../resource-date/resource-date.entity';
import { ResourceEntity } from '../../resource/resource.entity';
import {
  canonicalHash,
  canonicalJson,
} from '../../execution/execution-canonical';

class DateExtractionResourceNotFoundError extends Error {}

type PersistedResourceDate = Pick<
  ResourceDateEntity,
  | 'date'
  | 'endDate'
  | 'rawExpression'
  | 'precision'
  | 'charOffset'
  | 'contextSnippet'
  | 'unresolvedReason'
>;

@Injectable()
export class DateExtractionProcessor implements ExecutionProcessor {
  private readonly TASK_TYPE = 'date-extraction';

  constructor(private readonly effectJournal: ExecutionEffectJournalService) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = Number(execution.payload['resourceId']);
    const result = execution.result as { dates?: ResourceDatePayload[] };

    if (!resourceId || isNaN(resourceId)) {
      throw new Error(
        `Invalid resourceId in date-extraction execution: ${resourceId}`,
      );
    }
    if (!result || !Array.isArray(result.dates)) {
      throw new Error(
        `Invalid execution result for date-extraction on resource ${resourceId}`,
      );
    }

    const dates = this.canonicalDates(result.dates);
    let datesExtracted: number;
    try {
      const effect = await this.effectJournal.runVerified(
        {
          executionId: execution.executionId,
          effectKey: `date-extraction-resource-replace:${resourceId}`,
          effectType: 'resource_dates_replace',
          resourceKey: `resource-dates:${resourceId}`,
          intent: { resourceId, dates },
        },
        async (manager) => {
          const resources = manager.getRepository(ResourceEntity);
          const resource = await resources.findOne({
            where: { id: resourceId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!resource) throw new DateExtractionResourceNotFoundError();

          const repository = manager.getRepository(ResourceDateEntity);
          const before = this.canonicalDates(
            await repository.find({ where: { resourceId } }),
          );
          await repository.delete({ resourceId });
          if (dates.length) {
            await repository.save(
              dates.map((date) => repository.create({ resourceId, ...date })),
            );
          }
          const observed = this.canonicalDates(
            await repository.find({ where: { resourceId } }),
          );
          if (canonicalHash(observed) !== canonicalHash(dates)) {
            throw new Error('resource_dates_effect_not_verified');
          }
          return {
            resourceId,
            datesExtracted: observed.length,
            beforeDatesHash: canonicalHash(before),
            afterDatesHash: canonicalHash(observed),
          };
        },
      );
      datesExtracted = Number(effect.observation.datesExtracted);
      if (!Number.isInteger(datesExtracted) || datesExtracted < 0) {
        throw new Error('resource_dates_observation_invalid');
      }
    } catch (error) {
      if (!(error instanceof DateExtractionResourceNotFoundError)) throw error;
      return {
        success: false,
        resourceId,
        reason: 'resource_not_found',
      };
    }

    return { success: true, resourceId, datesExtracted };
  }

  private canonicalDates(
    dates: Array<ResourceDatePayload | ResourceDateEntity>,
  ): PersistedResourceDate[] {
    return dates
      .map((date) => ({
        date: date.date ? String(date.date).slice(0, 10) : null,
        endDate: date.endDate ? String(date.endDate).slice(0, 10) : null,
        rawExpression: date.rawExpression,
        precision: date.precision ?? null,
        charOffset: date.charOffset ?? null,
        contextSnippet: date.contextSnippet ?? null,
        unresolvedReason: date.unresolvedReason ?? null,
      }))
      .sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      );
  }
}
