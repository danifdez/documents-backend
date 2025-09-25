import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { EntityService } from 'src/entity/entity.service';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class EntityExtractionProcessor implements JobProcessor {
  private readonly logger = new Logger(EntityExtractionProcessor.name);
  private readonly JOB_TYPE = 'entity-extraction';

  // Map ML model entity types to database entity types
  private readonly entityTypeMapping = {
    'PER': 'PERSON',
    'MISC': 'MISC',
    'LOC': 'LOCATION',
    'ORG': 'ORGANIZATION'
  };

  constructor(
    private readonly resourceService: ResourceService,
    private readonly entityService: EntityService,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const resourceId = Number(job.payload['resourceId']) as number;
    const result = job.result as { entities: Array<{ word: string; entity: string }> };

    // Validate resourceId
    if (!resourceId || isNaN(resourceId)) {
      const errorMessage = `Invalid resource ID: ${resourceId}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Check if resource exists first
    const resourceExists = await this.resourceService.resourceExists(resourceId);
    if (!resourceExists) {
      const errorMessage = `Resource with id ${resourceId} does not exist in database`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Get the resource first to verify it exists
    const resource = await this.resourceService.findOne(resourceId);
    if (!resource) {
      const errorMessage = `Resource with id ${resourceId} not found (exists check passed but findOne returned null)`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      // Clear existing entities for this resource
      await this.resourceService.clearResourceEntities(resourceId);
    } catch (error) {
      this.logger.error(`Failed to clear entities for resource ${resourceId}:`, error.message);
      throw error;
    }

    // Process each extracted entity
    for (const entityData of result.entities) {
      try {
        // Map the entity type from ML model to database entity type
        const mappedEntityType = this.entityTypeMapping[entityData.entity] || 'MISC';

        // Find or create the entity
        const entity = await this.entityService.findOrCreate(
          entityData.word,
          mappedEntityType
        );

        // Add entity to resource
        await this.resourceService.addEntityToResource(resourceId, entity);
      } catch (error) {
        this.logger.warn(`Failed to process entity ${entityData.word}:`, error.message);
      }
    }

    this.logger.log(`Successfully processed ${result.entities.length} entities for resource ${resourceId}`);
    return { success: true, entitiesProcessed: result.entities.length };
  }
}
