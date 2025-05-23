import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { resourceTypeProviders } from './resource-type.providers';
import { ResourceTypeController } from './resource-type.controller';
import { ResourceTypeService } from './resource-type.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ResourceTypeController],
  providers: [ResourceTypeService, ...resourceTypeProviders],
})
export class ResourceTypeModule { }
