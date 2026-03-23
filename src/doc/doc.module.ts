import { Module } from '@nestjs/common';
import { DocController } from './doc.controller';
import { DocService } from './doc.service';
import { DocIngestService } from './doc-ingest.service';
import { DatabaseModule } from '../database/database.module';
import { JobModule } from '../job/job.module';

@Module({
  imports: [DatabaseModule, JobModule],
  controllers: [DocController],
  providers: [DocService, DocIngestService],
  exports: [DocService],
})
export class DocModule { }
