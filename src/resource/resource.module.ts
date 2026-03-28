import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ResourceController } from './resource.controller';
import { ResourceService } from './resource.service';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { JobModule } from 'src/job/job.module';

@Module({
  imports: [DatabaseModule, FileStorageModule, JobModule],
  controllers: [ResourceController],
  providers: [ResourceService],
  exports: [ResourceService],
})
export class ResourceModule { }
