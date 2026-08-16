import { Injectable, Optional } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { JobEntity } from 'src/job/job.entity';
import { TranslationStrategy } from './translate/translation-strategy.interface';
import { ContentTranslationStrategy } from './translate/content-translation.strategy';
import { EntitiesPendingBatchTranslationStrategy } from './translate/entities-pending-batch-translation.strategy';
import { EntityRetranslationStrategy } from './translate/entity-retranslation.strategy';
import { EntitiesBatchTranslationStrategy } from './translate/entities-batch-translation.strategy';
import { EntityTranslationStrategy } from './translate/entity-translation.strategy';

@Injectable()
export class TranslateProcessor implements JobProcessor {
  private readonly JOB_TYPE = 'translate';

  constructor(
    private readonly contentStrategy: ContentTranslationStrategy,
    // Entity strategies are registered inside the `relationships` feature block,
    // so they leave the DI graph as a group when the feature is off — content
    // translation (the core path) still works without them. Entity-translation
    // job types are only ever created when the feature is on.
    @Optional()
    private readonly entitiesPendingBatchStrategy: EntitiesPendingBatchTranslationStrategy,
    @Optional()
    private readonly entityRetranslationStrategy: EntityRetranslationStrategy,
    @Optional()
    private readonly entitiesBatchStrategy: EntitiesBatchTranslationStrategy,
    @Optional()
    private readonly entityStrategy: EntityTranslationStrategy,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const translationType = job.payload['translationType'];

    const entityStrategies: Record<string, TranslationStrategy> = {
      'entities-pending-batch': this.entitiesPendingBatchStrategy,
      'entity-retranslate': this.entityRetranslationStrategy,
      'entities-batch': this.entitiesBatchStrategy,
      entity: this.entityStrategy,
    };

    if (translationType in entityStrategies) {
      const strategy = entityStrategies[translationType];
      if (!strategy) {
        throw new Error(
          `Translation type "${translationType}" requires the entities feature, which is disabled`,
        );
      }
      return strategy.execute(job);
    }

    return this.contentStrategy.execute(job);
  }
}
