import { Module } from '@nestjs/common';
import { ExecutionProcessorModule } from '../execution-processor/execution-processor.module';
import { ExecutionModule } from '../execution/execution.module';
import { ExecutionCoordinatorService } from './execution-coordinator.service';

@Module({
  imports: [ExecutionModule, ExecutionProcessorModule.register()],
  providers: [ExecutionCoordinatorService],
  exports: [ExecutionCoordinatorService],
})
export class ExecutionCoordinatorModule {}
