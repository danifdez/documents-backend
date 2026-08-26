/* eslint-disable @typescript-eslint/no-require-imports */
import { Module } from '@nestjs/common';
import { ExecutionProcessorFactory } from './execution-processor.factory';
import { DocumentExtractionProcessor } from './processors/document-extraction-processor';
import { DetectLanguageProcessor } from './processors/detect-language-processor';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { ResourceModule } from '../resource/resource.module';
import { NotificationModule } from '../notification/notification.module';
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
import { DatasetExtractionProcessor } from './processors/dataset-extraction-processor';
import { DatasetProposeColumnsProcessor } from './processors/dataset-propose-columns-processor';
import { DatasetModule } from '../dataset/dataset.module';
import { DataSourceSyncProcessor } from './processors/data-source-sync-processor';
import { TranscribeProcessor } from './processors/transcribe-processor';
import { DatabaseModule } from '../database/database.module';
import { RelationshipExtractionProcessor } from './processors/relationship-extraction-processor';
import { SearchProcessor } from './processors/search-processor';
import { DateExtractionProcessor } from './processors/date-extraction-processor';
import { AssistantChatProcessor } from './processors/assistant-chat-processor';
import { IndexedFileExtractionProcessor } from './processors/indexed-file-extraction-processor';
import { IndexedFileIngestProcessor } from './processors/indexed-file-ingest-processor';
import { AssistantModule } from '../assistant/assistant.module';
import { IndexedFileModule } from '../indexed-file/indexed-file.module';
import { AgentModule } from '../agent/agent.module';
import { readFeaturesFromEnv } from '../common/feature-flags';
import { ContentTranslationStrategy } from './processors/translate/content-translation.strategy';
import { EntityRetranslationStrategy } from './processors/translate/entity-retranslation.strategy';
import { ExecutionModule } from '../execution/execution.module';
import { VectorModule } from '../vector/vector.module';
import { VectorSearchProcessor } from './processors/vector-search-processor';

@Module({})
export class ExecutionProcessorModule {
  static register() {
    const features = readFeaturesFromEnv();

    // Dynamic imports for toggleable feature modules
    const featureImports: any[] = [];

    // All processors are registered; the factory skips those whose deps are missing
    const providers: any[] = [
      ExecutionProcessorFactory,
      DocumentExtractionProcessor,
      DetectLanguageProcessor,
      TranslateProcessor,
      ContentTranslationStrategy,
      IngestContentProcessor,
      SummarizeProcessor,
      KeyPointsProcessor,
      KeywordsProcessor,
      AskProcessor,
      TranscribeProcessor,
      SearchProcessor,
      VectorSearchProcessor,
      AssistantChatProcessor,
      IndexedFileExtractionProcessor,
      IndexedFileIngestProcessor,
    ];

    if (features.timelines) {
      const {
        ResourceDateModule,
      } = require('../resource-date/resource-date.module');
      featureImports.push(ResourceDateModule);
      providers.push(DateExtractionProcessor);
    }
    if (features.datasets) {
      const { DataSourceModule } = require('../data-source/data-source.module');
      featureImports.push(DatasetModule, DataSourceModule);
      providers.push(
        DatasetStatsProcessor,
        DatasetExtractionProcessor,
        DatasetProposeColumnsProcessor,
        DataSourceSyncProcessor,
      );
    }
    if (features.relationships) {
      const { EntityModule } = require('../entity/entity.module');
      const { EntityTypeModule } = require('../entity-type/entity-type.module');
      const {
        PendingEntityModule,
      } = require('../pending-entity/pending-entity.module');
      const { GraphModule } = require('../graph/graph.module');
      featureImports.push(
        EntityModule,
        EntityTypeModule,
        PendingEntityModule,
        GraphModule,
      );
      providers.push(
        EntityExtractionProcessor,
        RelationshipExtractionProcessor,
        EntityRetranslationStrategy,
      );
    }
    return {
      module: ExecutionProcessorModule,
      imports: [
        FileStorageModule,
        ResourceModule,
        NotificationModule,
        DocModule,
        ExecutionModule,
        HttpModule,
        DatabaseModule,
        AssistantModule,
        IndexedFileModule,
        AgentModule,
        VectorModule,
        ...featureImports,
      ],
      providers,
      exports: [ExecutionProcessorFactory],
    };
  }
}
