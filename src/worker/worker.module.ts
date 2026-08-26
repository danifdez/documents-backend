import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkerEntity } from './worker.entity';
import { WorkerService } from './worker.service';
import { ExecutionStepAttemptEntity } from '../execution/execution-step-attempt.entity';
import { WorkerController } from './worker.controller';
import { BrowserWorkController } from './browser-work.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkerEntity, ExecutionStepAttemptEntity]),
  ],
  controllers: [WorkerController, BrowserWorkController],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
