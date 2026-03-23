import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkerEntity } from './worker.entity';
import { WorkerService } from './worker.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkerEntity])],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
