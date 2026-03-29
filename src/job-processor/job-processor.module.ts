import { Module } from '@nestjs/common';
import { JobProcessorFactory } from './job-processor.factory';
import { DocumentExtractionProcessor } from './processors/document-extraction-processor';
import { DetectLanguageProcessor } from './processors/detect-language-processor';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { ResourceModule } from '../resource/resource.module';
import { NotificationModule } from '../notification/notification.module';
import { JobModule } from '../job/job.module';
import { DocModule } from '../doc/doc.module';
import { TranslateProcessor } from './processors/translate-processor';
import { EntityExtractionProcessor } from './processors/entity-extraction-processor';
import { HttpModule } from '@nestjs/axios';
import { IngestContentProcessor } from './processors/ingest-content-processor';
import { AskProcessor } from './processors/ask-processor';
import { SummarizeProcessor } from './processors/summarize-processor';
import { KeyPointsProcessor } from './processors/key-points-processor';
import { KeywordsProcessor } from './processors/keywords-processor';
import { DatasetStatsProcessor } from './processors/dataset-stats-processor';
import { TranscribeProcessor } from './processors/transcribe-processor';
import { ImageGenerateProcessor } from './processors/image-generate-processor';
import { ImageEditProcessor } from './processors/image-edit-processor';
import { DatabaseModule } from '../database/database.module';
import { RelationshipExtractionProcessor } from './processors/relationship-extraction-processor';
import { RelationshipQueryProcessor } from './processors/relationship-query-processor';
import { RelationshipModifyProcessor } from './processors/relationship-modify-processor';
import { DeleteVectorsProcessor } from './processors/delete-vectors-processor';
import { readFeaturesFromEnv } from '../common/feature-flags';

@Module({})
export class JobProcessorModule {
  static register() {
    const features = readFeaturesFromEnv();

    // Dynamic imports for toggleable feature modules
    const featureImports: any[] = [];
    if (features.entities) {
      const { EntityModule } = require('../entity/entity.module');
      const { EntityTypeModule } = require('../entity-type/entity-type.module');
      const { PendingEntityModule } = require('../pending-entity/pending-entity.module');
      featureImports.push(EntityModule, EntityTypeModule, PendingEntityModule);
    }

    // All processors are registered; the factory skips those whose deps are missing
    const providers: any[] = [
      JobProcessorFactory,
      DocumentExtractionProcessor,
      DetectLanguageProcessor,
      TranslateProcessor,
      IngestContentProcessor,
      SummarizeProcessor,
      KeyPointsProcessor,
      KeywordsProcessor,
      AskProcessor,
      TranscribeProcessor,
      ImageGenerateProcessor,
      ImageEditProcessor,
      DeleteVectorsProcessor,
    ];

    if (features.entities) providers.push(EntityExtractionProcessor);
    if (features.datasets) providers.push(DatasetStatsProcessor);
    if (features.relationships) providers.push(
      RelationshipExtractionProcessor,
      RelationshipQueryProcessor,
      RelationshipModifyProcessor,
    );

    return {
      module: JobProcessorModule,
      imports: [
        FileStorageModule,
        ResourceModule,
        NotificationModule,
        DocModule,
        JobModule,
        HttpModule,
        DatabaseModule,
        ...featureImports,
      ],
      providers,
      exports: [JobProcessorFactory],
    };
  }
}
