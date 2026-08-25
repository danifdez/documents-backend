import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ResourceController } from './resource.controller';
import { ResourceService } from './resource.service';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { ExecutionModule } from 'src/execution/execution.module';
import { GraphModule } from '../graph/graph.module';

@Module({
  imports: [DatabaseModule, FileStorageModule, ExecutionModule, GraphModule],
  controllers: [ResourceController],
  providers: [ResourceService],
  exports: [ResourceService],
})
export class ResourceModule {}
