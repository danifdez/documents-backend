import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionPriority } from '../../execution/execution-priority.enum';
import { ResourceService } from '../../resource/resource.service';
import { ExecutionService } from '../../execution/execution.service';
import { ExecutionEntity } from '../../execution/execution.entity';

@Injectable()
export class TranscribeProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(TranscribeProcessor.name);
  private readonly TASK_TYPE = 'transcribe';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly executionService: ExecutionService,
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

    if (!result?.transcript) {
      this.logger.warn(
        `Transcription produced no text for resource ${resourceId}`,
      );
      await this.resourceService.update(resourceId, {
        status: 'confirmed_extraction',
      });
      return {
        success: false,
        resourceId,
        reason: 'empty_transcript',
      };
    }

    const existingContent =
      await this.resourceService.getContentById(resourceId);

    const transcriptHtml =
      '<h3>Transcription</h3><div class="transcript">' +
      `${this.escapeHtml(result.transcript)}</div>`;
    const newContent = existingContent
      ? `${existingContent}\n${transcriptHtml}`
      : transcriptHtml;

    await this.resourceService.update(resourceId, {
      content: newContent,
      status: 'confirmed_extraction',
    });

    const samples = this.extractTextSamples(result.transcript);
    if (samples.length > 0) {
      await this.executionService.create(
        'detect-language',
        ExecutionPriority.NORMAL,
        {
          resourceId,
          samples,
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
      for (let i = 0; i < 2; i++) {
        const maxStart = text.length - 200;
        const start = Math.floor(Math.random() * maxStart);
        samples.push(text.substring(start, start + 200).trim());
      }
    }
    return samples.filter((s) => s.length > 0);
  }
}
