import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { ResourceService } from 'src/resource/resource.service';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class KeywordsProcessor implements JobProcessor {
    private readonly logger = new Logger(KeywordsProcessor.name);
    private readonly JOB_TYPE = 'keywords';

    constructor(
        private readonly resourceService: ResourceService,
        private readonly notificationGateway: NotificationGateway,
    ) { }

    canProcess(jobType: string): boolean {
        return jobType === this.JOB_TYPE;
    }

    async process(job: JobEntity): Promise<any> {
        const resourceId = job.payload['resourceId'] ? Number(job.payload['resourceId']) : null;
        const result = job.result as { keywords: string[] };

        if (resourceId && result && Array.isArray(result.keywords)) {
            try {
                await this.resourceService.update(resourceId, {
                    keywords: result.keywords,
                });

                this.notificationGateway.sendNotification({
                    type: 'keywords',
                    message: `Keywords extracted for resource ${resourceId}`,
                    resourceId: resourceId,
                });
            } catch (err) {
                this.logger.error('Failed to update resource with keywords', err);
            }
        } else {
            this.logger.warn('KeywordsProcessor: Invalid job result or missing resourceId');
        }

        return {
            success: true,
            message: 'Keywords processed',
        };
    }
}
