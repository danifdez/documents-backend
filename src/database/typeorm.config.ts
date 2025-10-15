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
    ],
    synchronize: false,
    logging: false,
  };
};
