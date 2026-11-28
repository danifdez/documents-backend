import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { DocModule } from '../doc/doc.module';
import { MarkModule } from '../mark/mark.module';
import { ResourceModule } from '../resource/resource.module';
import { NoteModule } from '../note/note.module';
import { CanvasModule } from '../canvas/canvas.module';
import { CalendarEventModule } from '../calendar-event/calendar-event.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { EntityModule } from '../entity/entity.module';
import { DatasetModule } from '../dataset/dataset.module';
import { ProjectModule } from '../project/project.module';
import { TimelineModule } from '../timeline/timeline.module';
import { BibliographyModule } from '../bibliography/bibliography.module';

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
    TimelineModule,
    BibliographyModule,
  ],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
