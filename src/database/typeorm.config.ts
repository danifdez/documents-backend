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
import { CanvasEntity } from '../canvas/canvas.entity';
import { DatasetEntity } from '../dataset/dataset.entity';
import { DatasetRecordEntity } from '../dataset/dataset-record.entity';
import { DatasetRelationEntity } from '../dataset/dataset-relation.entity';
import { DatasetRecordLinkEntity } from '../dataset/dataset-record-link.entity';
import { DatasetChartEntity } from '../dataset/dataset-chart.entity';
import { NoteEntity } from '../note/note.entity';
import { CalendarEventEntity } from '../calendar-event/calendar-event.entity';
import { TimelineEntity } from '../timeline/timeline.entity';
import { KnowledgeEntryEntity } from '../knowledge-base/knowledge-entry.entity';
import { BibliographyEntryEntity } from '../bibliography/bibliography-entry.entity';
import { UserTaskEntity } from '../user-task/user-task.entity';
import { WorkerEntity } from '../worker/worker.entity';
import { UserEntity } from '../auth/user.entity';

export const getTypeOrmConfig = async (configService: ConfigService): Promise<TypeOrmModuleOptions> => {
  return {
    type: 'postgres',
    host: String(configService.get('POSTGRES_HOST') ?? 'database'),
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
      CanvasEntity,
      DatasetEntity,
      DatasetRecordEntity,
      DatasetRelationEntity,
      DatasetRecordLinkEntity,
      DatasetChartEntity,
      NoteEntity,
      CalendarEventEntity,
      TimelineEntity,
      KnowledgeEntryEntity,
      BibliographyEntryEntity,
      UserTaskEntity,
      WorkerEntity,
      UserEntity,
    ],
    synchronize: false,
    logging: false,
  };
};
