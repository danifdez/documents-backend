import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { DataSourceSyncService } from '../../data-source/data-source-sync.service';

@Injectable()
export class DataSourceSyncProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(DataSourceSyncProcessor.name);

  constructor(private readonly syncService: DataSourceSyncService) {}

  canProcess(taskType: string): boolean {
    return taskType === 'data-source-sync';
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const dataSourceId = execution.payload?.['dataSourceId'];
    if (!dataSourceId) {
      throw new Error('Missing dataSourceId in execution payload');
    }

    this.logger.log(
      `Processing sync execution for data source ${dataSourceId}`,
    );
    const syncLog = await this.syncService.syncDataSource(dataSourceId);
    return { success: syncLog.status === 'success', syncLogId: syncLog.id };
  }
}
