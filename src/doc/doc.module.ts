import { Module } from '@nestjs/common';
import { DocController } from './doc.controller';
import { DocService } from './doc.service';
import { DocIngestService } from './doc-ingest.service';
import { DocExportService } from './doc-export.service';
import { DatabaseModule } from '../database/database.module';
import { ExecutionModule } from '../execution/execution.module';

@Module({
  imports: [DatabaseModule, ExecutionModule],
  controllers: [DocController],
  providers: [DocService, DocIngestService, DocExportService],
  exports: [DocService],
})
export class DocModule {}
