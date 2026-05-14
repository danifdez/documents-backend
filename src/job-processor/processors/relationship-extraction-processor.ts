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
    const result = (job.result || {}) as { relationships?: unknown[]; error?: string };
    const relationships = Array.isArray(result.relationships) ? result.relationships : [];
    const resourceId = job.payload['resourceId'] as number | undefined;

    if (result.error) {
      this.logger.warn(
        `Relationship extraction job ${job.id} returned error: ${result.error}`,
      );
      this.notificationGateway.sendRelationshipExtractionComplete({
        resourceId,
        relationships,
      });
      return { success: false, message: result.error, relationshipsExtracted: relationships.length };
    }

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
