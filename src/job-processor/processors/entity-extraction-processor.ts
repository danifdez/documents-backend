import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { EntityService } from 'src/entity/entity.service';
import { JobEntity } from 'src/job/job.entity';
import { PendingEntityService } from 'src/pending-entity/pending-entity.service';
import { JobService } from 'src/job/job.service';
import { JobPriority } from 'src/job/job-priority.enum';

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
    private readonly pendingEntityService: PendingEntityService,
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
      // Clear existing pending entities for this resource
      await this.pendingEntityService.clearByResourceId(resourceId);
    } catch (error) {
      this.logger.error(`Failed to clear pending entities for resource ${resourceId}:`, error.message);
      throw error;
    }

    // Since entities are extracted from working_content (always English),
    // we need to translate them to:
    // 1. The original document language (resource.language) - for 'extracted' view
    // 2. The target language (from settings, default 'es') - for 'translated' view
    const sourceLanguage = 'en'; // Entities are always in English from working_content
    const targetLanguage = 'es'; // TODO: Get from settings API
    const documentLanguage = resource.language || 'en';

    // Build texts array for translation
    const textsForTranslation: Array<{ text: string }> = result.entities.map(entity => ({
      text: entity.word
    }));

    // Store entity data temporarily in the job payload for the translation processor
    const entityDataByIndex = result.entities.map(entity => ({
      word: entity.word,
      entityType: entity.entity,
    }));

    // Determine which languages we need to translate to
    const languagesToTranslate = new Set<string>();
    if (documentLanguage !== 'en') {
      languagesToTranslate.add(documentLanguage);
    }
    // Always add target language if it's different from English and document language
    if (targetLanguage !== documentLanguage) {
      languagesToTranslate.add(targetLanguage);
    }

    // Create a single translation job that will translate to all needed languages
    // and then create the pending entities
    await this.jobService.create('translate', JobPriority.HIGH, {
      translationType: 'entities-pending-batch',
      sourceLanguage,
      targetLanguages: Array.from(languagesToTranslate), // Multiple target languages
      texts: textsForTranslation,
      entityDataByIndex,
      resourceId,
    });

    this.logger.log(`Created translation job for ${result.entities.length} entities to languages: ${Array.from(languagesToTranslate).join(', ')}`);

    return {
      success: true,
      entitiesProcessed: result.entities.length,
      pendingTranslation: true,
      message: 'Entities will be created as pending after translation completes'
    };
  }
}
