import { Module } from '@nestjs/common';
import { ArchiveService } from './archive.service';
import { ArchiveController } from './archive.controller';
import { DatabaseModule } from '../database/database.module';
import { FileStorageModule } from '../file-storage/file-storage.module';
import { ExecutionModule } from '../execution/execution.module';

@Module({
    imports: [DatabaseModule, FileStorageModule, ExecutionModule],
    controllers: [ArchiveController],
    providers: [ArchiveService],
    exports: [ArchiveService],
})
export class ArchiveModule { }
