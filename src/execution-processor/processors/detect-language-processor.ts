import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { ExecutionService } from 'src/execution/execution.service';
import { ExecutionPriority } from 'src/execution/execution-priority.enum';
import { ExecutionEntity } from 'src/execution/execution.entity';
import { extractTextFromHtml } from 'src/utils/text';
import { buildDateExtractionWorkflowSteps } from 'src/model/date-extraction-workflow';

@Injectable()
export class DetectLanguageProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(DetectLanguageProcessor.name);
  private readonly TASK_TYPE = 'detect-language';

  constructor(
    private readonly resourceService: ResourceService,
    private readonly executionService: ExecutionService,
  ) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = Number(execution.payload['resourceId']) as number;
    const results = (execution.result as { results: { language: string }[] })
      .results;

    if (
      results[0].language !== 'unknown' &&
      results[0].language === results[1].language
    ) {
      const detectedLanguage = results[0].language;
      const resource = await this.resourceService.findOne(resourceId);
      const content = await this.resourceService.getContentById(resourceId);
      const projectId = (resource?.project as any)?.id || null;

      if (!content) {
        await this.resourceService.update(resourceId, {
          language: detectedLanguage,
          status: 'ready',
        });
        return;
      }

      // Original language is preserved — no translation. The content is ingested
      // as-is (multilingual embedding) and dates are extracted in the document's
      // own language.
      await this.resourceService.update(resourceId, {
        language: detectedLanguage,
        status: 'ready',
      });

      await this.executionService.create(
        'ingest-content',
        ExecutionPriority.NORMAL,
        {
          resourceId,
          projectId,
          content,
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
          chunkCount: dateSteps.length - 1,
        },
        { steps: dateSteps },
      );
    }
  }
}
