import { Module } from '@nestjs/common';
import { TaskScheduleService } from './task-schedule.service';
import { ExecutionModule } from '../execution/execution.module';
import { WorkerModule } from '../worker/worker.module';
import { ExecutionCoordinatorModule } from '../execution-coordinator/execution-coordinator.module';

@Module({
  imports: [ExecutionModule, ExecutionCoordinatorModule, WorkerModule],
  providers: [TaskScheduleService],
  exports: [TaskScheduleService],
})
export class TaskScheduleModule {}
