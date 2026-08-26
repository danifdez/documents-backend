import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { ExecutionEffectJournalService } from '../../execution/execution-effect-journal.service';
import { DocEntity } from '../../doc/doc.entity';
import { canonicalHash } from '../../execution/execution-canonical';
import { ResourceEntity } from '../../resource/resource.entity';

class TargetDocumentNotFoundError extends Error {}
class TargetResourceNotFoundError extends Error {}

@Injectable()
export class SummarizeProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(SummarizeProcessor.name);
  private readonly TASK_TYPE = 'summarize';

  constructor(private readonly effectJournal: ExecutionEffectJournalService) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = execution.payload['resourceId']
      ? Number(execution.payload['resourceId'])
      : null;
    const targetDocId = execution.payload['targetDocId']
      ? Number(execution.payload['targetDocId'])
      : null;
    const result = execution.result as { response?: string; error?: string };

    if (result?.error) {
      this.logger.warn(
        `Summarization execution ${execution.executionId} returned error: ${result.error}`,
      );
      return {
        success: false,
        message: result.error,
        publication: {
          socketEvent: 'notification',
          payload: {
            type: 'summarization',
            message: `Document summarization failed: ${result.error}`,
            resourceId: resourceId ?? undefined,
            docId: targetDocId ?? undefined,
          },
        },
      };
    }

    const summary = result?.response ?? '';

    let message: string;
    if (targetDocId) {
      try {
        await this.effectJournal.runVerified(
          {
            executionId: execution.executionId,
            effectKey: `summarize-document-append:${targetDocId}`,
            effectType: 'document_content_append',
            resourceKey: `document:${targetDocId}`,
            intent: { targetDocId, summary },
          },
          async (manager) => {
            const repository = manager.getRepository(DocEntity);
            const doc = await repository.findOne({
              where: { id: targetDocId },
              lock: { mode: 'pessimistic_write' },
            });
            if (!doc) throw new TargetDocumentNotFoundError();
            const before = doc.content || '';
            const content = `${before}\n\n${summary}`;
            doc.content = content;
            await repository.save(doc);
            const observed = await repository.findOneBy({ id: targetDocId });
            if (observed?.content !== content) {
              throw new Error('document_summary_effect_not_verified');
            }
            return {
              documentId: targetDocId,
              beforeContentHash: canonicalHash(before),
              appendedContentHash: canonicalHash(summary),
              afterContentHash: canonicalHash(content),
            };
          },
        );
      } catch (error) {
        if (!(error instanceof TargetDocumentNotFoundError)) throw error;
        return {
          success: false,
          message: `Target document ${targetDocId} not found`,
        };
      }
      message = 'Document summarization appended to workspace document';
    } else {
      if (resourceId) {
        try {
          await this.effectJournal.runVerified(
            {
              executionId: execution.executionId,
              effectKey: `summarize-resource-replace:${resourceId}`,
              effectType: 'resource_summary_replace',
              resourceKey: `resource:${resourceId}`,
              intent: { resourceId, summary },
            },
            async (manager) => {
              const repository = manager.getRepository(ResourceEntity);
              const resource = await repository.findOne({
                where: { id: resourceId },
                lock: { mode: 'pessimistic_write' },
              });
              if (!resource) throw new TargetResourceNotFoundError();
              const before = resource.summary;
              resource.summary = summary;
              await repository.save(resource);
              const observed = await repository.findOneBy({ id: resourceId });
              if (observed?.summary !== summary) {
                throw new Error('resource_summary_effect_not_verified');
              }
              return {
                resourceId,
                beforeSummaryHash: canonicalHash(before),
                afterSummaryHash: canonicalHash(summary),
              };
            },
          );
        } catch (error) {
          if (!(error instanceof TargetResourceNotFoundError)) throw error;
          return {
            success: false,
            message: `Target resource ${resourceId} not found`,
          };
        }
      }

      message = `Document summarization completed${resourceId ? ' for resource' : ''}`;
    }

    return {
      success: true,
      message: 'Summarization processed',
      publication: {
        socketEvent: 'notification',
        payload: {
          type: 'summarization',
          message,
          resourceId: resourceId ?? undefined,
          docId: targetDocId ?? undefined,
        },
      },
    };
  }
}
