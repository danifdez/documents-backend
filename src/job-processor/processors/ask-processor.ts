import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class AskProcessor implements JobProcessor {
  private readonly logger = new Logger(AskProcessor.name);
  private readonly JOB_TYPE = 'ask';

  constructor(private readonly notificationGateway: NotificationGateway) {}

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const response = job.result['response'] as string;
    this.notificationGateway.sendAskResponse({
      response,
    });

    return {
      success: true,
    };
  }
}
