import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';
import { ExecutionContractValidator } from './execution-contract-validator';

@Module({
  imports: [DatabaseModule],
  controllers: [ExecutionController],
  providers: [ExecutionService, ExecutionContractValidator],
  exports: [ExecutionService],
})
export class ExecutionModule {}
