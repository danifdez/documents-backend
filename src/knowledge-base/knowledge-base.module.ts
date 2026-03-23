import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { JobModule } from '../job/job.module';
import { KnowledgeEntryController } from './knowledge-entry.controller';
import { KnowledgeEntryService } from './knowledge-entry.service';

@Module({
    imports: [DatabaseModule, JobModule],
    controllers: [KnowledgeEntryController],
    providers: [KnowledgeEntryService],
    exports: [KnowledgeEntryService],
})
export class KnowledgeBaseModule { }
