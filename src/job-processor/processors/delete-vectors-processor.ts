import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class DeleteVectorsProcessor implements JobProcessor {
  private readonly logger = new Logger(DeleteVectorsProcessor.name);
  private readonly JOB_TYPE = 'delete-vectors';

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    this.logger.log(`Vectors deleted for source: ${job.payload['sourceId']}`);
  }
}
