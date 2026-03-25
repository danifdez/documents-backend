import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';

const DATASET_JOB_TYPES = new Set([
  'distribution',
  'correlation',
  'correlation-matrix',
  'group-by',
  'time-series',
  'outliers',
  'pivot-table',
  'summary',
  'query',
  'chart',
]);

@Injectable()
export class DatasetStatsProcessor implements JobProcessor {
  private readonly logger = new Logger(DatasetStatsProcessor.name);

  constructor(
    private readonly notificationGateway: NotificationGateway,
  ) { }

  canProcess(jobType: string): boolean {
    return DATASET_JOB_TYPES.has(jobType);
  }

  async process(job: JobEntity): Promise<any> {
    const datasetId = job.payload['datasetId'];
    const result = job.result as Record<string, any>;

    if (result?.error) {
      this.logger.warn(`Stats analysis failed for dataset ${datasetId}: ${result.error}`);
    }

    this.notificationGateway.sendNotification({
      type: job.type,
      message: result?.error
        ? `Statistical analysis failed for dataset`
        : `Statistical analysis completed`,
      datasetId,
      jobId: job.id,
    });

    return {
      success: !result?.error,
      message: 'Dataset stats processed',
    };
  }
}
