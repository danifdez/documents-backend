import { Module } from '@nestjs/common';
import { TaskScheduleService } from './task-schedule.service';
import { JobModule } from 'src/job/job.module';
import { FileStorageModule } from 'src/file-storage/file-storage.module';
import { ResourceModule } from 'src/resource/resource.module';
import { JobProcessorModule } from 'src/job-processor/job-processor.module';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [
    DatabaseModule,
    JobModule,
    FileStorageModule,
    ResourceModule,
    JobProcessorModule,
  ],
  providers: [TaskScheduleService],
  exports: [TaskScheduleService],
})
export class TaskScheduleModule {}
