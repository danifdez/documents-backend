import { Logger } from '@nestjs/common';
import { ExecutionEntity } from 'src/execution/execution.entity';
import {
  TranslationStrategy,
  TRANSLATE_LOG_CONTEXT,
} from './translation-strategy.interface';

export interface TranslationResults {
  response: Array<{
    path?: string;
    original_text?: string;
    translation_text: string;
  }>;
}

// Not registered in DI: only the concrete strategies are providers.
export abstract class TranslationStrategyBase implements TranslationStrategy {
  protected readonly logger = new Logger(TRANSLATE_LOG_CONTEXT);

  abstract execute(execution: ExecutionEntity): Promise<any>;

  protected ensureExecutionResult(execution: ExecutionEntity): void {
    if (!execution.result) {
      const errorMessage = `Execution result is null or undefined`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  // Batch strategies accept an empty response array, hence no length check here.
  protected getBatchResults(
    execution: ExecutionEntity,
    translationType: string,
  ): TranslationResults {
    this.ensureExecutionResult(execution);

    const results = execution.result as TranslationResults;
    if (!results?.response || !Array.isArray(results.response)) {
      const errorMessage = `Invalid translation result format for ${translationType}: ${JSON.stringify(results)}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    return results;
  }
}

// Template method for strategies that translate a single entity resolved by
// `payload.entityId`; subclasses keep their own literals and result shapes.
export abstract class SingleEntityTranslationStrategyBase<
  TEntity,
> extends TranslationStrategyBase {
  async execute(execution: ExecutionEntity): Promise<any> {
    const entityId = Number(execution.payload['entityId']) as number;

    this.logStart(execution, entityId);
    this.logger.debug(`Execution result: ${JSON.stringify(execution.result)}`);

    if (!entityId || isNaN(entityId)) {
      const errorMessage = `Invalid entity ID: ${entityId}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    this.validatePayload(execution);

    this.ensureExecutionResult(execution);

    const results = execution.result as TranslationResults;

    if (
      !results?.response ||
      !Array.isArray(results.response) ||
      results.response.length === 0
    ) {
      const errorMessage = `Invalid translation result format. Expected response array but got: ${JSON.stringify(results)}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const entity = await this.findEntity(entityId);
    if (!entity) {
      const errorMessage = this.entityNotFoundMessage(entityId);
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      // Await inside try so async failures are logged with the strategy-specific prefix.
      return await this.applyTranslations(execution, entityId, entity, results);
    } catch (error) {
      this.logger.error(this.updateFailureMessage(entityId), error.message);
      throw error;
    }
  }

  // Runs before any validation, so it may throw on malformed payloads
  // exactly as the original inline logging did.
  protected abstract logStart(
    execution: ExecutionEntity,
    entityId: number,
  ): void;

  protected abstract validatePayload(execution: ExecutionEntity): void;

  protected abstract findEntity(entityId: number): Promise<TEntity | null>;

  protected abstract entityNotFoundMessage(entityId: number): string;

  protected abstract updateFailureMessage(entityId: number): string;

  protected abstract applyTranslations(
    execution: ExecutionEntity,
    entityId: number,
    entity: TEntity,
    results: TranslationResults,
  ): Promise<any>;
}
