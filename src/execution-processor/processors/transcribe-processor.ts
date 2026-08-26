import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionService } from '../../execution/execution.service';
import { ExecutionEntity } from '../../execution/execution.entity';
import { ExecutionEffectJournalService } from '../../execution/execution-effect-journal.service';
import { ResourceEntity } from '../../resource/resource.entity';
import { canonicalHash } from '../../execution/execution-canonical';

@Injectable()
export class TranscribeProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(TranscribeProcessor.name);
  private readonly TASK_TYPE = 'transcribe';

  constructor(
    private readonly executionService: ExecutionService,
    private readonly effectJournal: ExecutionEffectJournalService,
  ) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = Number(execution.payload['resourceId']);
    const result = execution.result as {
      transcript?: string;
      language?: string;
      language_probability?: number;
      duration?: number;
    };
    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      throw new Error('Transcription execution requires a valid resourceId');
    }

    if (!result?.transcript) {
      this.logger.warn(
        `Transcription produced no text for resource ${resourceId}`,
      );
      await this.effectJournal.runVerified(
        {
          executionId: execution.executionId,
          effectKey: `transcribe-empty-resource-status:${resourceId}`,
          effectType: 'resource_status_replace',
          resourceKey: `resource:${resourceId}`,
          intent: { resourceId, status: 'confirmed_extraction' },
        },
        async (manager) => {
          const repository = manager.getRepository(ResourceEntity);
          const resource = await repository.findOne({
            where: { id: resourceId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!resource) throw new Error(`Resource ${resourceId} not found`);
          const before = resource.status;
          resource.status = 'confirmed_extraction';
          await repository.save(resource);
          const observed = await repository.findOneBy({ id: resourceId });
          if (observed?.status !== 'confirmed_extraction') {
            throw new Error('transcription_empty_effect_not_verified');
          }
          return {
            resourceId,
            beforeStatusHash: canonicalHash(before),
            afterStatusHash: canonicalHash(observed.status),
          };
        },
      );
      return {
        success: false,
        resourceId,
        reason: 'empty_transcript',
      };
    }

    const transcriptHtml =
      '<h3>Transcription</h3><div class="transcript">' +
      `${this.escapeHtml(result.transcript)}</div>`;
    await this.effectJournal.runVerified(
      {
        executionId: execution.executionId,
        effectKey: `transcribe-resource-content:${resourceId}`,
        effectType: 'resource_transcription_append',
        resourceKey: `resource:${resourceId}`,
        intent: { resourceId, transcript: result.transcript },
      },
      async (manager) => {
        const repository = manager.getRepository(ResourceEntity);
        const resource = await repository.findOne({
          where: { id: resourceId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!resource) throw new Error(`Resource ${resourceId} not found`);
        const before = resource.content;
        const content = before
          ? `${before}\n${transcriptHtml}`
          : transcriptHtml;
        resource.content = content;
        resource.status = 'confirmed_extraction';
        await repository.save(resource);
        const observed = await repository.findOneBy({ id: resourceId });
        if (
          observed?.content !== content ||
          observed.status !== 'confirmed_extraction'
        ) {
          throw new Error('transcription_effect_not_verified');
        }
        return {
          resourceId,
          beforeContentHash: canonicalHash(before),
          afterContentHash: canonicalHash(content),
          statusHash: canonicalHash(observed.status),
        };
      },
    );

    const samples = this.extractTextSamples(result.transcript);
    if (samples.length > 0) {
      if (!execution.lastEventId) {
        throw new Error('Transcription execution has no causal event');
      }
      const payload = {
        resourceId,
        samples,
      };
      await this.executionService.createChildInferenceOnce(
        execution.executionId,
        `transcribe:detect-language:${resourceId}`,
        {
          taskType: 'detect-language',
          payload,
          work: { taskType: 'detect-language', payload },
          requiredCapability: 'detect-language',
          causedByEventId: execution.lastEventId,
        },
      );
    }

    this.logger.log(
      `Transcription completed for resource ${resourceId}: ` +
        `language=${result.language}, duration=${result.duration}s`,
    );

    return {
      success: true,
      resourceId,
      publication: {
        socketEvent: 'notification',
        payload: {
          type: 'transcribe',
          message: `Transcription completed for resource ${resourceId}.`,
          resourceId,
        },
      },
    };
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private extractTextSamples(text: string): string[] {
    const samples: string[] = [];
    if (text.length <= 400) {
      const mid = Math.floor(text.length / 2);
      samples.push(text.substring(0, Math.min(200, mid)).trim());
      samples.push(
        text.substring(mid, mid + Math.min(200, text.length - mid)).trim(),
      );
    } else {
      samples.push(text.substring(0, 200).trim());
      samples.push(text.substring(text.length - 200).trim());
    }
    return samples.filter((s) => s.length > 0);
  }
}
