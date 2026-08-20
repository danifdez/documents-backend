import { Module } from '@nestjs/common';
import { ModelController } from './model.controller';
import { ExecutionModule } from 'src/execution/execution.module';
import { ResourceModule } from 'src/resource/resource.module';
import { ModelService } from './model.service';

@Module({
  imports: [ExecutionModule, ResourceModule],
  controllers: [ModelController],
  providers: [ModelService],
  exports: [ModelService],
})
export class ModelModule { }
