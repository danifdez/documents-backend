import { Module } from '@nestjs/common';
import { ReadingPointController } from './reading-point.controller';
import { ReadingPointService } from './reading-point.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ReadingPointController],
  providers: [ReadingPointService],
  exports: [ReadingPointService],
})
export class ReadingPointModule {}
