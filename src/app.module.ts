import { resolve } from 'path';
import { DynamicModule, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReferenceModule } from './reference/reference.module';
import { ProjectModule } from './project/project.module';
import { ThreadModule } from './thread/thread.module';
import { DocModule } from './doc/doc.module';
import { ResourceModule } from './resource/resource.module';
import { ResourceTypeModule } from './resource-type/resource-type.module';
import { FileStorageModule } from './file-storage/file-storage.module';
import { JobModule } from './job/job.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TaskScheduleModule } from './task-schedule/task-schedule.module';
import { JobProcessorModule } from './job-processor/job-processor.module';
import { NotificationModule } from './notification/notification.module';
import { VoiceModule } from './voice/voice.module';
import { ConfigModule } from '@nestjs/config';
import { CommentModule } from './comment/comment.module';
import { MarkModule } from './mark/mark.module';
import { ModelModule } from './model/model.module';
import { SearchModule } from './search/search.module';
import { EntityTypeModule } from './entity-type/entity-type.module';
import { EntityModule } from './entity/entity.module';
import { AuthorModule } from './author/author.module';
import { PendingEntityModule } from './pending-entity/pending-entity.module';
import { ExportModule } from './export/export.module';
import { CanvasModule } from './canvas/canvas.module';
import { DatasetModule } from './dataset/dataset.module';
import { NoteModule } from './note/note.module';
import { CalendarEventModule } from './calendar-event/calendar-event.module';
import { TimelineModule } from './timeline/timeline.module';
import { ResourceDateModule } from './resource-date/resource-date.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { BibliographyModule } from './bibliography/bibliography.module';
import { UserTaskModule } from './user-task/user-task.module';
import { RelationshipModule } from './relationship/relationship.module';
import { DataSourceModule } from './data-source/data-source.module';
import { WorkerModule } from './worker/worker.module';
import { AuthModule } from './auth/auth.module';
import { OfflineModule } from './offline/offline.module';
import { ArchiveModule } from './archive/archive.module';
import { FeatureFlagModule } from './common/feature-flags.module';
import { AssistantModule } from './assistant/assistant.module';
import { AssistantMemoryModule } from './assistant-memory/assistant-memory.module';
import { IndexedFileModule } from './indexed-file/indexed-file.module';
import { AgentModule } from './agent/agent.module';
import { AppStateModule } from './app-state/app-state.module';
import { readFeaturesFromEnv } from './common/feature-flags';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConditionalAuthGuard } from './auth/guards/conditional-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';

@Module({})
export class AppModule {
  static register(): DynamicModule {
    const features = readFeaturesFromEnv();

    const imports: any[] = [
      // Infrastructure (always loaded)
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: resolve(__dirname, '..', '..', '.env'),
      }),
      ThrottlerModule.forRoot([{
        ttl: 60000,
        limit: 100,
        skipIf: () => process.env.NODE_ENV === 'test',
      }]),
      ScheduleModule.forRoot(),
      FeatureFlagModule,
      AppStateModule,

      // Core modules (always loaded)
      ProjectModule,
      ThreadModule,
      DocModule,
      ResourceModule,
      ResourceTypeModule,
      FileStorageModule,
      JobModule,
      JobProcessorModule.register(),
      TaskScheduleModule,
      NotificationModule,
      VoiceModule,
      CommentModule,
      MarkModule,
      ModelModule,
      ReferenceModule,
      SearchModule,
      ExportModule,
      WorkerModule,
      AuthModule,
      OfflineModule.register(),
      ArchiveModule,

      // Base modules (always loaded)
      NoteModule,
      CalendarEventModule,
      UserTaskModule,
      AssistantModule,
      AssistantMemoryModule,
      IndexedFileModule,
      AgentModule,
      AuthorModule,
    ];

    // Toggleable feature modules
    if (features.canvas) imports.push(CanvasModule);
    if (features.datasets) imports.push(DatasetModule, DataSourceModule);
    if (features.timelines) imports.push(TimelineModule, ResourceDateModule);
    if (features.knowledge_base) imports.push(KnowledgeBaseModule);
    if (features.bibliography) imports.push(BibliographyModule);
    if (features.relationships) imports.push(EntityTypeModule, EntityModule, PendingEntityModule, RelationshipModule);

    return {
      module: AppModule,
      imports,
      controllers: [AppController],
      providers: [
        AppService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: ConditionalAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    };
  }
}
