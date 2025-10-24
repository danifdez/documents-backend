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

    // Get the resource and validate it exists. Avoid double DB calls (resourceExists + findOne).
    const resource = await this.resourceService.findOne(resourceId);
    if (!resource) {
      const errorMessage = `Resource with id ${resourceId} does not exist or could not be loaded`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Validate job result shape early to fail fast and avoid unnecessary DB work
    if (!result || !Array.isArray(result.entities)) {
      const errorMessage = `Invalid job result for entity-extraction on resource ${resourceId}`;
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

    // Process each extracted entity with limited concurrency to avoid blocking the event loop
    const concurrency = 5; // small default concurrency; consider making this configurable

    // Simple concurrency-limited mapper
    const mapWithConcurrency = async <T, R>(items: T[], fn: (t: T, idx: number) => Promise<R>, limit = 5): Promise<R[]> => {
      const results: R[] = new Array(items.length);
      let idx = 0;

      const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
        while (true) {
          const i = idx++;
          if (i >= items.length) break;
          try {
            results[i] = await fn(items[i], i);
          } catch (err) {
            // Preserve position with undefined result for failures
            this.logger.warn(`mapWithConcurrency: item ${i} failed: ${err?.message ?? err}`);
            results[i] = undefined as unknown as R;
          }
        }
      });

      await Promise.all(workers);
      return results;
    };

    const processedEntities = (await mapWithConcurrency(result.entities, async (entityData) => {
      if (!entityData || !entityData.word) {
        throw new Error('Invalid entity data');
      }

      // Map the entity type from ML model to database entity type (fallback to null)
      const mappedEntityType = this.entityTypeMapping[entityData.entity] || null;

      // Find or create the entity, then attach it to the resource.
      const entity = await this.entityService.findOrCreate(entityData.word, mappedEntityType);
      await this.resourceService.addEntityToResource(resourceId, entity);
      return entity;
    }, concurrency)).filter(Boolean);


    // Build a batch of texts for entities that need Spanish translations
    const textsForTranslation: Array<{ text: string }> = [];
    const entityIdByIndex: number[] = [];

    for (const entity of processedEntities) {
      if (!entity) continue;
      const hasSpanishTranslation = !!(entity.translations && entity.translations['es']);
      if (!hasSpanishTranslation) {
        textsForTranslation.push({ text: entity.name });
        entityIdByIndex.push(entity.id);
      }
    }

    if (textsForTranslation.length > 0) {
      await this.jobService.create('translate', JobPriority.LOW, {
        translationType: 'entities-batch',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        texts: textsForTranslation,
        entityIdByIndex,
        resourceId,
      });
    }

    return { success: true, entitiesProcessed: result.entities.length };
  }
}
