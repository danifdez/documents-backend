import { Injectable, Optional } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from 'src/execution/execution.entity';
import { TranslationStrategy } from './translate/translation-strategy.interface';
import { ContentTranslationStrategy } from './translate/content-translation.strategy';
import { EntityRetranslationStrategy } from './translate/entity-retranslation.strategy';

@Injectable()
export class TranslateProcessor implements ExecutionProcessor {
  private readonly TASK_TYPE = 'translate';

  constructor(
    private readonly contentStrategy: ContentTranslationStrategy,
    // Entity strategies are registered inside the `relationships` feature block,
    // so they leave the DI graph as a group when the feature is off — content
    // translation (the core path) still works without them. Entity-translation
    // execution types are only ever created when the feature is on.
    @Optional()
    private readonly entityRetranslationStrategy: EntityRetranslationStrategy,
  ) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const translationType = execution.payload['translationType'];

    const entityStrategies: Record<string, TranslationStrategy> = {
      'entity-retranslate': this.entityRetranslationStrategy,
    };

    if (
      typeof translationType === 'string' &&
      translationType in entityStrategies
    ) {
      const strategy = entityStrategies[translationType];
      if (!strategy) {
        throw new Error(
          `Translation type "${translationType}" requires the entities feature, which is disabled`,
        );
      }
      return strategy.execute(execution);
    }

    return this.contentStrategy.execute(execution);
  }
}
