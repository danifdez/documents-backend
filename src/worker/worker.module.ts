import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkerEntity } from './worker.entity';
import { WorkerService } from './worker.service';
import { ExecutionStepAttemptEntity } from '../execution/execution-step-attempt.entity';
import { WorkerController } from './worker.controller';
import { WorkerCredentialEventEntity } from './worker-credential-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkerEntity,
      WorkerCredentialEventEntity,
      ExecutionStepAttemptEntity,
    ]),
  ],
  controllers: [WorkerController],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
