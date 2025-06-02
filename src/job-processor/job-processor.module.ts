import { Module } from '@nestjs/common';
import { JobProcessorFactory } from './job-processor.factory';
import { DocumentExtractionProcessor } from './processors/document-extraction-processor';
import { DetectLanguageProcessor } from './processors/detect-language-processor';
import { FileStorageModule } from 'src/file-storage/file-storage.module';
import { ResourceModule } from 'src/resource/resource.module';
import { NotificationModule } from 'src/notification/notification.module';
import { JobModule } from 'src/job/job.module';
import { TranslateProcessor } from './processors/translate-processor';
import { EntityExtractionProcessor } from './processors/entity-extraction-processor';
import { HttpModule } from '@nestjs/axios';
import { JobProcessorClientService } from './job-processor-client.service';
import { IngestContentProcessor } from './processors/ingest-content-processor';
import { RagModule } from 'src/rag/rag.module';

@Module({
  imports: [
    FileStorageModule,
    ResourceModule,
    NotificationModule,
    JobModule,
    HttpModule,
    RagModule,
  ],
  providers: [
    JobProcessorFactory,
    DocumentExtractionProcessor,
    DetectLanguageProcessor,
    TranslateProcessor,
    EntityExtractionProcessor,
    JobProcessorClientService,
    IngestContentProcessor,
  ],
  exports: [JobProcessorFactory, JobProcessorClientService],
})
export class JobProcessorModule { }