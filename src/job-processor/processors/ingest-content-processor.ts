import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { Job } from 'src/job/job.interface';
import { RagClientService } from 'src/rag/rag-client.service';

@Injectable()
export class IngestContentProcessor implements JobProcessor {
  private readonly logger = new Logger(IngestContentProcessor.name);
  private readonly JOB_TYPE = 'ingest-content';

  constructor(private readonly ragClientService: RagClientService) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: Job): Promise<any> {
    const resourceId = job.payload['resourceId'] as string;
    const projectId = job.payload['projectId'] as string;
    const content = job.payload['content'] as string;

    await this.ragClientService.post('ingest', {
      source_id: resourceId,
      project_id: projectId,
      text: content,
    });
  }
}
