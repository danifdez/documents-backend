import { Controller, Post, Body } from '@nestjs/common';
import { JobPriority } from './job-priority.enum';
import { JobService } from './job.service';
import { JobEntity } from 'src/job/job.entity';

@Controller('jobs')
export class JobController {
  constructor(private readonly jobService: JobService) {}

  @Post()
  async create(@Body() job: any): Promise<JobEntity> {
    return await this.jobService.create(job.type, JobPriority.NORMAL, {
      content: job.content,
      sourceLanguage: job.sourceLanguage,
      targetLanguage: job.targetLanguage,
      resourceId: Number(job.resourceId),
    });
  }
}
