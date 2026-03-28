import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class RelationshipQueryProcessor implements JobProcessor {
  private readonly logger = new Logger(RelationshipQueryProcessor.name);
  private readonly JOB_TYPE = 'relationship-query';

  constructor(private readonly notificationGateway: NotificationGateway) {}

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const entities = job.result['entities'] || [];
    const relationships = job.result['relationships'] || [];
    const requestId = job.payload['requestId'] as string | undefined;

    this.notificationGateway.sendRelationshipQueryResponse({
      entities,
      relationships,
      requestId,
    });

    return {
      success: true,
    };
  }
}
