import { Controller, Post, Body } from '@nestjs/common';
import { Job, JobPriority } from './job.interface';
import { JobService } from './job.service';
import { JobRequest } from './job-request.interface';

@Controller('jobs')
export class JobController {
  constructor(private readonly jobService: JobService) { }

  @Post()
  async create(@Body() job: JobRequest): Promise<Job> {
    return await this.jobService.create(job.type, JobPriority.NORMAL, {
      content: job.content,
      sourceLanguage: job.sourceLanguage,
      targetLanguage: job.targetLanguage,
      resourceId: job.resourceId,
    });
  }
}
