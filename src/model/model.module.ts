import { Module } from '@nestjs/common';
import { ModelController } from './model.controller';
import { JobModule } from 'src/job/job.module';
import { ResourceModule } from 'src/resource/resource.module';
import { ModelService } from './model.service';

@Module({
  imports: [JobModule, ResourceModule],
  controllers: [ModelController],
  providers: [ModelService],
  exports: [ModelService],
})
export class ModelModule { }
