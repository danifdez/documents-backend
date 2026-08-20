import { Injectable, Logger } from '@nestjs/common';
import { ExecutionService } from '../execution/execution.service';
import { ExecutionPriority } from '../execution/execution-priority.enum';

@Injectable()
export class DocIngestService {
  private readonly logger = new Logger(DocIngestService.name);
  private timers = new Map<number, NodeJS.Timeout>();
  private readonly DEBOUNCE_MS = 5000;

  constructor(private readonly executionService: ExecutionService) {}

  scheduleIngest(
    docId: number,
    projectId: number | undefined,
    content: string,
  ) {
    const existing = this.timers.get(docId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(async () => {
      this.timers.delete(docId);
      try {
        await this.executionService.create(
          'ingest-content',
          ExecutionPriority.BACKGROUND,
          {
            docId,
            projectId,
            content,
            sourceType: 'doc',
          },
        );
        this.logger.log(`Scheduled ingest execution for doc ${docId}`);
      } catch (error) {
        this.logger.error(
          `Failed to create ingest execution for doc ${docId}: ${error.message}`,
        );
      }
    }, this.DEBOUNCE_MS);

    this.timers.set(docId, timer);
  }
}
