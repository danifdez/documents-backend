import { Module } from '@nestjs/common';
import { RelationshipController } from './relationship.controller';
import { RelationshipService } from './relationship.service';
import { ExecutionModule } from '../execution/execution.module';
import { ResourceModule } from '../resource/resource.module';
import { EntityModule } from '../entity/entity.module';
import { GraphModule } from '../graph/graph.module';

@Module({
  imports: [ExecutionModule, ResourceModule, EntityModule, GraphModule],
  controllers: [RelationshipController],
  providers: [RelationshipService],
  exports: [RelationshipService],
})
export class RelationshipModule {}
