import { Module } from '@nestjs/common';
import { ExecutionCoordinatorModule } from '../execution-coordinator/execution-coordinator.module';
import { ExecutionModule } from '../execution/execution.module';
import { WorkerModule } from '../worker/worker.module';
import { ExecutionOperationsController } from './execution-operations.controller';
import { ExecutionOperationsService } from './execution-operations.service';

@Module({
  imports: [ExecutionModule, ExecutionCoordinatorModule, WorkerModule],
  controllers: [ExecutionOperationsController],
  providers: [ExecutionOperationsService],
})
export class ExecutionOperationsModule {}
