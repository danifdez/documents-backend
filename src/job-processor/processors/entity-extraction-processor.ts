import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { EntityService } from 'src/entity/entity.service';
import { JobService } from 'src/job/job.service';
import { JobPriority } from 'src/job/job-priority.enum';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class EntityExtractionProcessor implements JobProcessor {
  private readonly logger = new Logger(EntityExtractionProcessor.name);
  private readonly JOB_TYPE = 'entity-extraction';

  // Map spaCy entity types to standardized database entity types
  // Comprehensive mapping for all spaCy en_core_web_trf entity types
  private readonly entityTypeMapping = {
    // Geographic and political entities
    'GPE': 'GEOPOLITICAL',        // Countries, cities, states
    'LOC': 'LOCATION',            // Non-GPE locations, mountain ranges, bodies of water
    'NORP': 'NATIONALITY',        // Nationalities or religious or political groups

    // Human and organizational entities
    'PERSON': 'PERSON',           // People, including fictional
    'ORG': 'ORGANIZATION',        // Companies, agencies, institutions, etc.

    // Cultural and creative entities
    'EVENT': 'EVENT',             // Named hurricanes, battles, wars, sports events, etc.
    'FAC': 'FACILITY',            // Buildings, airports, highways, bridges, etc.
    'PRODUCT': 'PRODUCT',         // Objects, vehicles, foods, etc. (not services)
    'WORK_OF_ART': 'WORK_OF_ART', // Titles of books, songs, etc.
    'LANGUAGE': 'LANGUAGE',       // Any named language
    'LAW': 'LAW',                 // Named documents made into laws
  };

  constructor(
    private readonly resourceService: ResourceService,
    private readonly entityService: EntityService,
    private readonly jobService: JobService,
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
    const processedEntities = [];
    for (const entityData of result.entities) {
      try {
        // Map the entity type from ML model to database entity type
        const mappedEntityType = this.entityTypeMapping[entityData.entity];

        // Find or create the entity
        const entity = await this.entityService.findOrCreate(
          entityData.word,
          mappedEntityType
        );

        // Add entity to resource
        await this.resourceService.addEntityToResource(resourceId, entity);
        processedEntities.push(entity);
      } catch (error) {
        this.logger.warn(`Failed to process entity ${entityData.word}:`, error.message);
      }
    }

    // Build a batch of texts for entities that need Spanish translations
    const textsForTranslation: Array<{ text: string }> = [];
    const entityIdByIndex: number[] = [];

    for (const entity of processedEntities) {
      const hasSpanishTranslation = entity.translations && entity.translations['es'];
      if (!hasSpanishTranslation) {
        // Use resource language as source; if missing, assume 'en' (we still translate to 'es')
        const sourceLanguage = 'en';
        // Only translate when source is different from target
        textsForTranslation.push({ text: entity.name });
        entityIdByIndex.push(entity.id);
      }
    }

    if (textsForTranslation.length > 0) {
      // Create a single batch translate job to translate all missing entity names to Spanish
      await this.jobService.create('translate', JobPriority.LOW, {
        translationType: 'entities-batch',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        texts: textsForTranslation,
        entityIdByIndex,
        resourceId,
      });

      this.logger.log(`Created batch translate job for ${textsForTranslation.length} entities for resource ${resourceId}`);
    }

    this.logger.log(`Successfully processed ${result.entities.length} entities for resource ${resourceId}`);
    return { success: true, entitiesProcessed: result.entities.length };
  }
}
