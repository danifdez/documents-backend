import { Module } from '@nestjs/common';
import { ModelController } from './model.controller';
import { ExecutionModule } from 'src/execution/execution.module';
import { ResourceModule } from 'src/resource/resource.module';
import { ModelService } from './model.service';
import { VectorModule } from '../vector/vector.module';
import { GraphModule } from '../graph/graph.module';
import { BrowserInferenceController } from './browser-inference.controller';

@Module({
  imports: [ExecutionModule, ResourceModule, VectorModule, GraphModule],
  controllers: [ModelController, BrowserInferenceController],
  providers: [ModelService],
  exports: [ModelService],
})
export class ModelModule {}
