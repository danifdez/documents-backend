import { Module } from '@nestjs/common';
import { JobService } from './job.service';
import { DatabaseModule } from '../database/database.module';
import { JobController } from './job.controller';

@Module({
  imports: [DatabaseModule],
  providers: [JobService],
  exports: [JobService],
  controllers: [JobController],
})
export class JobModule { }