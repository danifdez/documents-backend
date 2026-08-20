import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatasetController } from './dataset.controller';
import { DatasetService } from './dataset.service';
import { DatasetQueryService } from './dataset-query.service';
import { DatasetCsvService } from './dataset-csv.service';
import { DatasetExtractionService } from './dataset-extraction.service';
import { ExecutionModule } from '../execution/execution.module';
import { ResourceModule } from '../resource/resource.module';

@Module({
  imports: [DatabaseModule, ExecutionModule, ResourceModule],
  controllers: [DatasetController],
  providers: [
    DatasetService,
    DatasetQueryService,
    DatasetCsvService,
    DatasetExtractionService,
  ],
  exports: [DatasetService, DatasetExtractionService],
})
export class DatasetModule {}
