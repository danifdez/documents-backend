import { Module } from '@nestjs/common';
import { RelationshipController } from './relationship.controller';
import { RelationshipService } from './relationship.service';
import { ExecutionModule } from 'src/execution/execution.module';
import { ResourceModule } from 'src/resource/resource.module';
import { EntityModule } from 'src/entity/entity.module';

@Module({
  imports: [ExecutionModule, ResourceModule, EntityModule],
  controllers: [RelationshipController],
  providers: [RelationshipService],
  exports: [RelationshipService],
})
export class RelationshipModule {}
