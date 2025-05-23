import { Module } from '@nestjs/common';
import { JobService } from './job.service';
import { jobProviders } from './job.providers';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [JobService, ...jobProviders],
  exports: [JobService],
})
export class JobModule { }