import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { DocModule } from 'src/doc/doc.module';
import { MarkModule } from 'src/mark/mark.module';
import { ResourceModule } from 'src/resource/resource.module';
import { CanvasModule } from 'src/canvas/canvas.module';
import { NoteModule } from 'src/note/note.module';
import { CalendarEventModule } from 'src/calendar-event/calendar-event.module';
import { KnowledgeBaseModule } from 'src/knowledge-base/knowledge-base.module';
import { EntityModule } from 'src/entity/entity.module';
import { DatasetModule } from 'src/dataset/dataset.module';

@Module({
  imports: [DatabaseModule, DocModule, MarkModule, ResourceModule, CanvasModule, NoteModule, CalendarEventModule, KnowledgeBaseModule, EntityModule, DatasetModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule { }
