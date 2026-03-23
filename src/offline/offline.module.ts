import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OfflineController } from './offline.controller';
import { OfflineService } from './offline.service';
import { OfflineEnabledGuard } from './guards/offline-enabled.guard';
import { ResourceEntity } from '../resource/resource.entity';
import { DocEntity } from '../doc/doc.entity';
import { ThreadEntity } from '../thread/thread.entity';
import { CommentEntity } from '../comment/comment.entity';
import { MarkEntity } from '../mark/mark.entity';
import { NoteEntity } from '../note/note.entity';
import { ProjectEntity } from '../project/project.entity';
import { FileStorageModule } from '../file-storage/file-storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ResourceEntity,
      DocEntity,
      ThreadEntity,
      CommentEntity,
      MarkEntity,
      NoteEntity,
      ProjectEntity,
    ]),
    FileStorageModule,
  ],
  controllers: [OfflineController],
  providers: [OfflineService, OfflineEnabledGuard],
})
export class OfflineModule {}
