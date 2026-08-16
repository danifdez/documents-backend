import { JobEntity } from 'src/job/job.entity';

// Shared so every strategy keeps logging under the original context.
export const TRANSLATE_LOG_CONTEXT = 'TranslateProcessor';

export interface TranslationStrategy {
  execute(job: JobEntity): Promise<any>;
}
