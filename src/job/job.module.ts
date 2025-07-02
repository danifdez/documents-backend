import { Module } from '@nestjs/common';
import { JobService } from './job.service';
import { jobProviders } from './job.providers';
import { DatabaseModule } from '../database/database.module';
import { JobController } from './jobs.controller';

@Module({
  imports: [DatabaseModule],
  providers: [JobService, ...jobProviders],
  exports: [JobService],
  controllers: [JobController],
})
export class JobModule { }