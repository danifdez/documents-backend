import { Job } from 'src/job/job.interface';

/**
 * Interface for job processors
 * All job processors must implement this interface
 */
export interface JobProcessor {
  /**
   * Process a job
   * @param job The job to process
   * @returns Promise resolving to the processing result
   */
  process(job: Job): Promise<any>;

  /**
   * Checks if this processor can handle the given job type
   * @param jobType The job type to check
   * @returns true if this processor can handle the job type
   */
  canProcess(jobType: string): boolean;
}
