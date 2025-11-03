import { Module } from '@nestjs/common';
import { JobProcessorFactory } from './job-processor.factory';
import { DocumentExtractionProcessor } from './processors/document-extraction-processor';
import { DetectLanguageProcessor } from './processors/detect-language-processor';
import { FileStorageModule } from 'src/file-storage/file-storage.module';
import { ResourceModule } from 'src/resource/resource.module';
import { NotificationModule } from 'src/notification/notification.module';
import { JobModule } from 'src/job/job.module';
import { DocModule } from 'src/doc/doc.module';
import { TranslateProcessor } from './processors/translate-processor';
import { EntityExtractionProcessor } from './processors/entity-extraction-processor';
import { HttpModule } from '@nestjs/axios';
import { IngestContentProcessor } from './processors/ingest-content-processor';
import { AskProcessor } from './processors/ask-processor';
import { SummarizeProcessor } from './processors/summarize-processor';
import { EntityModule } from 'src/entity/entity.module';
import { DatabaseModule } from 'src/database/database.module';
import { PendingEntityModule } from 'src/pending-entity/pending-entity.module';

@Module({
  imports: [
    FileStorageModule,
    ResourceModule,
    NotificationModule,
    DocModule,
    JobModule,
    HttpModule,
    EntityModule,
    DatabaseModule,
    PendingEntityModule,
  ],
  providers: [
    JobProcessorFactory,
    DocumentExtractionProcessor,
    DetectLanguageProcessor,
    TranslateProcessor,
    EntityExtractionProcessor,
    IngestContentProcessor,
    SummarizeProcessor,
    AskProcessor,
  ],
  exports: [JobProcessorFactory],
})
export class JobProcessorModule { }