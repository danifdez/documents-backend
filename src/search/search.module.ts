import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { DocModule } from 'src/doc/doc.module';
import { MarkModule } from 'src/mark/mark.module';
import { ResourceModule } from 'src/resource/resource.module';
import { NoteModule } from 'src/note/note.module';
import { CanvasModule } from 'src/canvas/canvas.module';
import { CalendarEventModule } from 'src/calendar-event/calendar-event.module';
import { KnowledgeBaseModule } from 'src/knowledge-base/knowledge-base.module';
import { EntityModule } from 'src/entity/entity.module';
import { DatasetModule } from 'src/dataset/dataset.module';
import { ProjectModule } from 'src/project/project.module';

// SearchService's @Optional() constructor dependencies (notes, canvas, KB,
// events, entities, datasets) were never wired here, so global search via
// POST /search came back empty even when those features were enabled. Now
// imported so the corresponding services are actually injected.
@Module({
  imports: [
    DatabaseModule,
    DocModule,
    MarkModule,
    ResourceModule,
    NoteModule,
    CanvasModule,
    CalendarEventModule,
    KnowledgeBaseModule,
    EntityModule,
    DatasetModule,
    ProjectModule,
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule { }
