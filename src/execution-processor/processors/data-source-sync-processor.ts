import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { DataSourceSyncService } from '../../data-source/data-source-sync.service';
import { ExecutionEffectJournalService } from '../../execution/execution-effect-journal.service';
import {
  canonicalDomainHash,
  contentHash,
} from '../../execution/execution-canonical';

@Injectable()
export class DataSourceSyncProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(DataSourceSyncProcessor.name);

  constructor(
    private readonly syncService: DataSourceSyncService,
    private readonly effectJournal: ExecutionEffectJournalService,
  ) {}

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
    const effectKey = `data-source-sync:${dataSourceId}`;
    const effectType = 'data_source_dataset_sync';
    const resourceKey = `data-source:${dataSourceId}`;
    const verified = await this.effectJournal.getVerifiedObservation(
      execution.executionId,
      effectKey,
      effectType,
      resourceKey,
    );
    if (verified) {
      return {
        success: verified.status === 'success',
        syncLogId: verified.syncLogId,
      };
    }
    const prepared = await this.syncService.prepareSync(Number(dataSourceId));
    const effect = await this.effectJournal.runVerified(
      {
        executionId: execution.executionId,
        effectKey,
        effectType,
        resourceKey,
        intent: {
          dataSourceId: Number(dataSourceId),
          sourceIdentityHash: prepared.sourceIdentityHash,
          recordsHash: canonicalDomainHash(prepared.records),
          schemaHash: canonicalDomainHash(prepared.schema),
          errorHash: prepared.error ? contentHash(prepared.error) : null,
        },
      },
      async (manager) => {
        const applied = await this.syncService.applyPreparedSync(
          prepared,
          manager,
        );
        return {
          status: applied.status,
          syncLogId: applied.syncLogId,
          ...applied.observation,
        };
      },
    );
    return {
      success: effect.observation.status === 'success',
      syncLogId: effect.observation.syncLogId,
    };
  }
}
