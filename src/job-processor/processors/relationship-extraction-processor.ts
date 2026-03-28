import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class RelationshipExtractionProcessor implements JobProcessor {
  private readonly logger = new Logger(RelationshipExtractionProcessor.name);
  private readonly JOB_TYPE = 'relationship-extraction';

  constructor(private readonly notificationGateway: NotificationGateway) {}

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const relationships = job.result['relationships'] || [];
    const resourceId = job.payload['resourceId'] as number | undefined;

    this.logger.log(
      `Relationship extraction complete for resource ${resourceId}: ${relationships.length} relationships found`,
    );

    this.notificationGateway.sendRelationshipExtractionComplete({
      resourceId,
      relationships,
    });

    return {
      success: true,
      relationshipsExtracted: relationships.length,
    };
  }
}
