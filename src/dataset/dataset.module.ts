import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DatasetController } from './dataset.controller';
import { DatasetService } from './dataset.service';
import { DatasetQueryService } from './dataset-query.service';
import { DatasetCsvService } from './dataset-csv.service';
import { JobModule } from '../job/job.module';

@Module({
    imports: [DatabaseModule, JobModule],
    controllers: [DatasetController],
    providers: [DatasetService, DatasetQueryService, DatasetCsvService],
    exports: [DatasetService],
})
export class DatasetModule { }
