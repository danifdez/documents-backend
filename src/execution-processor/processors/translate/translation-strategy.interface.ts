import { ExecutionEntity } from 'src/execution/execution.entity';

// Shared so every strategy keeps logging under the original context.
export const TRANSLATE_LOG_CONTEXT = 'TranslateProcessor';

export interface TranslationStrategy {
  execute(execution: ExecutionEntity): Promise<any>;
}
