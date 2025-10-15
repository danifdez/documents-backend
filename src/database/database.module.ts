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
    ]),
  ],
  providers: [...databaseProviders],
  exports: [...databaseProviders, TypeOrmModule],
})
export class DatabaseModule { }