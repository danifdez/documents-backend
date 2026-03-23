import { Injectable, Logger } from '@nestjs/common';
import { JobService } from '../job/job.service';
import { JobPriority } from '../job/job-priority.enum';

@Injectable()
export class DocIngestService {
  private readonly logger = new Logger(DocIngestService.name);
  private timers = new Map<number, NodeJS.Timeout>();
  private readonly DEBOUNCE_MS = 5000;

  constructor(private readonly jobService: JobService) { }

  scheduleIngest(docId: number, projectId: number | undefined, content: string) {
    const existing = this.timers.get(docId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(async () => {
      this.timers.delete(docId);
      try {
        await this.jobService.create('ingest-content', JobPriority.BACKGROUND, {
          docId,
          projectId,
          content,
          sourceType: 'doc',
        });
        this.logger.log(`Scheduled ingest job for doc ${docId}`);
      } catch (error) {
        this.logger.error(`Failed to create ingest job for doc ${docId}: ${error.message}`);
      }
    }, this.DEBOUNCE_MS);

    this.timers.set(docId, timer);
  }
}
