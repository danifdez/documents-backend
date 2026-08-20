import { Module } from '@nestjs/common';
import { TaskScheduleService } from './task-schedule.service';
import { ExecutionModule } from 'src/execution/execution.module';
import { FileStorageModule } from 'src/file-storage/file-storage.module';
import { ExecutionProcessorModule } from 'src/execution-processor/execution-processor.module';
import { DatabaseModule } from 'src/database/database.module';
import { WorkerModule } from 'src/worker/worker.module';

@Module({
  imports: [
    DatabaseModule,
    ExecutionModule,
    FileStorageModule,
    ExecutionProcessorModule.register(),
    WorkerModule,
  ],
  providers: [TaskScheduleService],
  exports: [TaskScheduleService],
})
export class TaskScheduleModule { }