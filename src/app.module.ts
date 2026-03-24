import { resolve } from 'path';
import { Module } from '@nestjs/common';
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
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { BibliographyModule } from './bibliography/bibliography.module';
import { UserTaskModule } from './user-task/user-task.module';
import { WorkerModule } from './worker/worker.module';
import { AuthModule } from './auth/auth.module';
import { OfflineModule } from './offline/offline.module';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConditionalAuthGuard } from './auth/guards/conditional-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';

@Module({
  imports: [
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
    ProjectModule,
    ThreadModule,
    DocModule,
    ResourceModule,
    ResourceTypeModule,
    FileStorageModule,
    JobModule,
    JobProcessorModule,
    TaskScheduleModule,
    NotificationModule,
    CommentModule,
    MarkModule,
    ModelModule,
    ReferenceModule,
    SearchModule,
    EntityTypeModule,
    EntityModule,
    AuthorModule,
    PendingEntityModule,
    ExportModule,
    CanvasModule,
    DatasetModule,
    NoteModule,
    CalendarEventModule,
    TimelineModule,
    KnowledgeBaseModule,
    BibliographyModule,
    UserTaskModule,
    WorkerModule,
    AuthModule,
    OfflineModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ConditionalAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule { }
