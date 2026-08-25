import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AgeGraphService } from './age-graph.service';

@Module({
  imports: [DatabaseModule],
  providers: [AgeGraphService],
  exports: [AgeGraphService],
})
export class GraphModule {}
