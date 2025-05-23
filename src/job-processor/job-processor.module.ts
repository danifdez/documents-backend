import { Module } from '@nestjs/common';
import { JobProcessorFactory } from './job-processor.factory';
import { DocumentExtractionProcessor } from './processors/document-extraction-processor';
import { DetectLanguageProcessor } from './processors/detect-language-processor';
import { ExtractionModule } from 'src/extraction/extraction.module';
import { FileStorageModule } from 'src/file-storage/file-storage.module';
import { ResourceModule } from 'src/resource/resource.module';
import { NotificationModule } from 'src/notification/notification.module';
import { JobModule } from 'src/job/job.module';
import { TranslateProcessor } from './processors/translate-processor';
import { EntityExtractionProcessor } from './processors/entity-extraction-processor';

@Module({
  imports: [
    ExtractionModule,
    FileStorageModule,
    ResourceModule,
    NotificationModule,
    JobModule,
  ],
  providers: [
    JobProcessorFactory,
    DocumentExtractionProcessor,
    DetectLanguageProcessor,
    TranslateProcessor,
    EntityExtractionProcessor,
  ],
  exports: [JobProcessorFactory],
})
export class JobProcessorModule { }