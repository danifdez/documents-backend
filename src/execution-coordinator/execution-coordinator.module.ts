import { Module } from '@nestjs/common';
import { ExecutionProcessorModule } from '../execution-processor/execution-processor.module';
import { ExecutionModule } from '../execution/execution.module';
import { ExecutionCoordinatorService } from './execution-coordinator.service';
import { ExecutionOutboxModule } from '../execution-outbox/execution-outbox.module';

@Module({
  imports: [
    ExecutionModule,
    ExecutionProcessorModule.register(),
    ExecutionOutboxModule,
  ],
  providers: [ExecutionCoordinatorService],
  exports: [ExecutionCoordinatorService],
})
export class ExecutionCoordinatorModule {}
