import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
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
import { EventOccurrenceCompletionEntity } from '../calendar-event/event-occurrence-completion.entity';
import { TimelineEntity } from '../timeline/timeline.entity';
import { ResourceDateEntity } from '../resource-date/resource-date.entity';
import { KnowledgeEntryEntity } from '../knowledge-base/knowledge-entry.entity';
import { BibliographyEntryEntity } from '../bibliography/bibliography-entry.entity';
import { UserTaskEntity } from '../user-task/user-task.entity';
import { WorkerEntity } from '../worker/worker.entity';
import { UserEntity } from '../auth/user.entity';
import { PermissionGroupEntity } from '../auth/permission-group.entity';
import { DataSourceEntity } from '../data-source/data-source.entity';
import { DataSourceSyncLogEntity } from '../data-source/data-source-sync-log.entity';
import { AssistantEntity } from '../assistant/assistant.entity';
import { AssistantMessageEntity } from '../assistant/assistant-message.entity';
import { MemoryEntryEntity } from '../assistant-memory/memory-entry.entity';
import { IndexedFileEntity } from '../indexed-file/indexed-file.entity';
import { AgentEntity } from '../agent/agent.entity';
import { AgentMessageEntity } from '../agent/agent-message.entity';
import { AppStateEntity } from '../app-state/app-state.entity';

export const getTypeOrmConfig = async (configService: ConfigService): Promise<TypeOrmModuleOptions> => {
  return {
    type: 'postgres',
    host: String(configService.get('POSTGRES_HOST') ?? '127.0.0.1'),
    port: Number(configService.get('POSTGRES_PORT') ?? 5432),
    username: String(configService.get('POSTGRES_USER') ?? 'postgres'),
    password: String(configService.get('POSTGRES_PASSWORD') ?? ''),
    database: String(configService.get('POSTGRES_DB') ?? 'documents'),
    entities: [
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
      EventOccurrenceCompletionEntity,
      TimelineEntity,
      ResourceDateEntity,
      KnowledgeEntryEntity,
      BibliographyEntryEntity,
      UserTaskEntity,
      WorkerEntity,
      UserEntity,
      PermissionGroupEntity,
      DataSourceEntity,
      DataSourceSyncLogEntity,
      AssistantEntity,
      AssistantMessageEntity,
      MemoryEntryEntity,
      IndexedFileEntity,
      AgentEntity,
      AgentMessageEntity,
      AppStateEntity,
    ],
    synchronize: false,
    // In embedded/standalone mode the database is created empty, so the backend
    // applies pending migrations on boot. Gated by env so dev (which runs
    // `migration:run` manually) is unaffected. Idempotent: TypeORM only runs
    // migrations not yet recorded in the migrations table.
    migrations: [__dirname + '/../../migrations/*.js'],
    migrationsRun: configService.get('RUN_MIGRATIONS') === 'true',
    logging: false,
  };
};
