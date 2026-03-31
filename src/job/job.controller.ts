import { Controller, Post, Body } from '@nestjs/common';
import { JobPriority } from './job-priority.enum';
import { JobService } from './job.service';
import { JobEntity } from 'src/job/job.entity';
import { CreateJobDto } from './dto/job.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('jobs')
export class JobController {
  constructor(private readonly jobService: JobService) { }

  @Post()
  @RequirePermissions(Permission.WRITE)
  async create(@Body() job: CreateJobDto): Promise<JobEntity> {
    return await this.jobService.create(job.type, JobPriority.NORMAL, {
      content: job.content,
      sourceLanguage: job.sourceLanguage,
      targetLanguage: job.targetLanguage,
      resourceId: job.resourceId ? Number(job.resourceId) : undefined,
    });
  }
}
