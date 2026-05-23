import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { JobEntity } from '../../job/job.entity';
import { DatasetExtractionService } from '../../dataset/dataset-extraction.service';
import { NotificationGateway } from '../../notification/notification.gateway';

@Injectable()
export class DatasetExtractionProcessor implements JobProcessor {
    private readonly logger = new Logger(DatasetExtractionProcessor.name);

    constructor(
        private readonly extractionService: DatasetExtractionService,
        private readonly notificationGateway: NotificationGateway,
    ) { }

    canProcess(jobType: string): boolean {
        return jobType === 'dataset.extract-row';
    }

    async process(job: JobEntity): Promise<any> {
        const payload = (job.payload || {}) as {
            datasetId?: number;
            recordId?: number;
            columnsToExtract?: string[];
        };
        const recordId = Number(payload.recordId);
        const datasetId = Number(payload.datasetId);
        const columns = Array.isArray(payload.columnsToExtract) ? payload.columnsToExtract : [];

        if (!recordId || !datasetId) {
            this.logger.warn(`dataset.extract-row job ${job.id} missing datasetId/recordId in payload`);
            return { success: false, message: 'Invalid payload' };
        }

        const result = (job.result || {}) as any;
        const { status } = await this.extractionService.applyExtractionResult(recordId, result, columns);

        this.notificationGateway.sendNotification({
            type: job.type,
            message: status === 'failed'
                ? `Dataset extraction failed for row ${recordId}`
                : `Dataset row ${recordId} extracted`,
            datasetId,
            recordId,
            extractionStatus: status,
            jobId: job.id,
        });

        return { success: status !== 'failed', message: `record ${recordId} -> ${status}` };
    }
}
