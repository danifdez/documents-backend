import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { JobEntity } from '../../job/job.entity';
import { DataSourceSyncService } from '../../data-source/data-source-sync.service';

@Injectable()
export class DataSourceSyncProcessor implements JobProcessor {
    private readonly logger = new Logger(DataSourceSyncProcessor.name);

    constructor(
        private readonly syncService: DataSourceSyncService,
    ) {}

    canProcess(jobType: string): boolean {
        return jobType === 'data-source-sync';
    }

    async process(job: JobEntity): Promise<any> {
        const dataSourceId = job.payload?.['dataSourceId'];
        if (!dataSourceId) {
            throw new Error('Missing dataSourceId in job payload');
        }

        this.logger.log(`Processing sync job for data source ${dataSourceId}`);
        const syncLog = await this.syncService.syncDataSource(dataSourceId);
        return { success: syncLog.status === 'success', syncLogId: syncLog.id };
    }
}
