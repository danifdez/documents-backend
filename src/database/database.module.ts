import { Module } from '@nestjs/common';
import { databaseProviders } from './database.providers';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getTypeOrmConfig } from './typeorm.config';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JobEntity } from '../job/job.entity';
import { ResourceEntity } from '../resource/resource.entity';
import { ProjectEntity } from '../project/project.entity';
import { DocEntity } from '../doc/doc.entity';
import { MarkEntity } from '../mark/mark.entity';
import { CommentEntity } from '../comment/comment.entity';
import { ResourceTypeEntity } from '../resource-type/resource-type.entity';
import { ThreadEntity } from '../thread/thread.entity';
import { EntityTypeEntity } from '../entity-type/entity-type.entity';
import { EntityEntity } from '../entity/entity.entity';
import { ResourceEntityEntity } from '../resource-entity/resource-entity.entity';
import { AuthorEntity } from '../author/author.entity';
import { ResourceAuthorEntity } from '../author/resource-author.entity';
import { PendingEntityEntity } from '../pending-entity/pending-entity.entity';
import { EntityProjectEntity } from '../entity-project/entity-project.entity';
import { CanvasEntity } from '../canvas/canvas.entity';
import { DatasetEntity } from '../dataset/dataset.entity';
import { DatasetRecordEntity } from '../dataset/dataset-record.entity';
import { DatasetRelationEntity } from '../dataset/dataset-relation.entity';
import { DatasetRecordLinkEntity } from '../dataset/dataset-record-link.entity';
import { DatasetChartEntity } from '../dataset/dataset-chart.entity';
import { NoteEntity } from '../note/note.entity';
import { CalendarEventEntity } from '../calendar-event/calendar-event.entity';
import { KnowledgeEntryEntity } from '../knowledge-base/knowledge-entry.entity';
import { TimelineEntity } from '../timeline/timeline.entity';
import { BibliographyEntryEntity } from '../bibliography/bibliography-entry.entity';
import { UserTaskEntity } from '../user-task/user-task.entity';
import { WorkerEntity } from '../worker/worker.entity';
import { UserEntity } from '../auth/user.entity';
import { PermissionGroupEntity } from '../auth/permission-group.entity';
import { DataSourceEntity } from '../data-source/data-source.entity';
import { DataSourceSyncLogEntity } from '../data-source/data-source-sync-log.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => getTypeOrmConfig(configService),
    }),
    TypeOrmModule.forFeature([
      JobEntity,
      ResourceEntity,
      ProjectEntity,
      DocEntity,
      MarkEntity,
      CommentEntity,
      ResourceTypeEntity,
      ThreadEntity,
      EntityTypeEntity,
      EntityEntity,
      ResourceEntityEntity,
      AuthorEntity,
      ResourceAuthorEntity,
      PendingEntityEntity,
      EntityProjectEntity,
      CanvasEntity,
      DatasetEntity,
      DatasetRecordEntity,
      DatasetRelationEntity,
      DatasetRecordLinkEntity,
      DatasetChartEntity,
      NoteEntity,
      CalendarEventEntity,
      KnowledgeEntryEntity,
      TimelineEntity,
      BibliographyEntryEntity,
      UserTaskEntity,
      WorkerEntity,
      UserEntity,
      PermissionGroupEntity,
      DataSourceEntity,
      DataSourceSyncLogEntity,
    ]),
  ],
  providers: [...databaseProviders],
  exports: [...databaseProviders, TypeOrmModule],
})
export class DatabaseModule { }