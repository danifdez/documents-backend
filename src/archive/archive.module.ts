import { Module } from '@nestjs/common';
import { ArchiveService } from './archive.service';
import { ArchiveController } from './archive.controller';
import { DatabaseModule } from '../database/database.module';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { JobModule } from '../job/job.module';

@Module({
    imports: [DatabaseModule, FileStorageModule, JobModule],
    controllers: [ArchiveController],
    providers: [ArchiveService],
    exports: [ArchiveService],
})
export class ArchiveModule { }
