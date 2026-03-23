import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { DatabaseModule } from '../database/database.module';
import { FileStorageModule } from '../file-storage/file-storage.module';

@Module({
  imports: [DatabaseModule, FileStorageModule],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
