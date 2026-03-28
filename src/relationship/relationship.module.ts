import { Module } from '@nestjs/common';
import { RelationshipController } from './relationship.controller';
import { RelationshipService } from './relationship.service';
import { JobModule } from 'src/job/job.module';
import { ResourceModule } from 'src/resource/resource.module';
import { EntityModule } from 'src/entity/entity.module';

@Module({
  imports: [JobModule, ResourceModule, EntityModule],
  controllers: [RelationshipController],
  providers: [RelationshipService],
  exports: [RelationshipService],
})
export class RelationshipModule {}
