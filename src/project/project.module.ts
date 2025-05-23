import { Module } from '@nestjs/common';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { projectProviders } from './project.providers';
import { DatabaseModule } from '../database/database.module';
import { ThreadModule } from 'src/thread/thread.module';
import { DocModule } from 'src/doc/doc.module';

@Module({
  imports: [DatabaseModule, ThreadModule, DocModule],
  controllers: [ProjectController],
  providers: [ProjectService, ...projectProviders],
})
export class ProjectModule { }
