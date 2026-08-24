import { Module } from '@nestjs/common';
import { TaskScheduleService } from './task-schedule.service';
import { ExecutionModule } from 'src/execution/execution.module';
import { WorkerModule } from 'src/worker/worker.module';
import { ExecutionCoordinatorModule } from 'src/execution-coordinator/execution-coordinator.module';

@Module({
  imports: [ExecutionModule, ExecutionCoordinatorModule, WorkerModule],
  providers: [TaskScheduleService],
  exports: [TaskScheduleService],
})
export class TaskScheduleModule {}
