import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { JobEntity } from 'src/job/job.entity';
import { ResourceDateService } from 'src/resource-date/resource-date.service';
import { ResourceDatePayload } from 'src/resource-date/dto/resource-date.dto';

@Injectable()
export class DateExtractionProcessor implements JobProcessor {
  private readonly logger = new Logger(DateExtractionProcessor.name);
  private readonly JOB_TYPE = 'date-extraction';

  constructor(private readonly resourceDateService: ResourceDateService) {}

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const resourceId = Number(job.payload['resourceId']);
    const anchorDate = (job.payload['anchorDate'] as string | null) ?? null;
    const result = job.result as { dates?: ResourceDatePayload[] };

    if (!resourceId || isNaN(resourceId)) {
      throw new Error(`Invalid resourceId in date-extraction job: ${resourceId}`);
    }
    if (!result || !Array.isArray(result.dates)) {
      throw new Error(`Invalid job result for date-extraction on resource ${resourceId}`);
    }

    const saved = await this.resourceDateService.replaceByResourceId(
      resourceId,
      result.dates,
      anchorDate,
    );

    this.logger.log(
      `Stored ${saved.length} dates for resource ${resourceId} (anchor=${anchorDate ?? 'none'})`,
    );

    return { success: true, resourceId, datesExtracted: saved.length };
  }
}
