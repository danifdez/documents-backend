import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { ExecutionEntity } from 'src/execution/execution.entity';

@Injectable()
export class RelationshipExtractionProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(RelationshipExtractionProcessor.name);
  private readonly TASK_TYPE = 'relationship-extraction';

  constructor(private readonly notificationGateway: NotificationGateway) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const result = (execution.result || {}) as {
      relationships?: unknown[];
      error?: string;
    };
    const relationships = Array.isArray(result.relationships)
      ? result.relationships
      : [];
    const resourceId = execution.payload['resourceId'] as number | undefined;

    if (result.error) {
      this.logger.warn(
        `Relationship extraction execution ${execution.executionId} returned error: ${result.error}`,
      );
      this.notificationGateway.sendRelationshipExtractionComplete({
        resourceId,
        relationships,
      });
      return {
        success: false,
        message: result.error,
        relationshipsExtracted: relationships.length,
      };
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
