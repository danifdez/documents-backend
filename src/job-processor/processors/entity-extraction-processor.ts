import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class EntityExtractionProcessor implements JobProcessor {
  private readonly logger = new Logger(EntityExtractionProcessor.name);
  private readonly JOB_TYPE = 'entity-extraction';

  constructor(private readonly resourceService: ResourceService) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const resourceId = Number(job.payload['resourceId']) as number;
    const result = job.result as { entities: any };

    this.resourceService.update(resourceId, {
      entities: result.entities,
    });

    return { success: true };
  }
}
