import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobProcessor } from '../job-processor.interface';
import { JobEntity } from 'src/job/job.entity';
import { JobService } from 'src/job/job.service';
import { JobPriority } from 'src/job/job-priority.enum';
import { IndexedFileEntity } from 'src/indexed-file/indexed-file.entity';

@Injectable()
export class IndexedFileExtractionProcessor implements JobProcessor {
  private readonly logger = new Logger(IndexedFileExtractionProcessor.name);
  private readonly JOB_TYPE = 'indexed-file-extraction';

  constructor(
    @InjectRepository(IndexedFileEntity)
    private readonly repository: Repository<IndexedFileEntity>,
    private readonly jobService: JobService,
  ) {}

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const indexedFileId = Number(job.payload['indexedFileId']);
    if (!indexedFileId) {
      throw new Error('indexed-file-extraction job missing indexedFileId');
    }

    const file = await this.repository.findOne({ where: { id: indexedFileId } });
    if (!file) {
      this.logger.warn(`IndexedFile ${indexedFileId} no longer exists; skipping`);
      return { success: false, reason: 'not_found' };
    }

    const jobChecksum = job.payload['checksum'] as string | undefined;
    if (jobChecksum && jobChecksum !== file.checksum) {
      this.logger.log(
        `[indexed-file] discarding stale extraction for id=${indexedFileId} (checksum changed)`,
      );
      return { success: false, reason: 'stale' };
    }

    const result = job.result as { content?: string; error?: string } | null;
    const text = typeof result?.content === 'string' ? result.content : '';

    file.extractedText = text;
    await this.repository.save(file);

    this.logger.log(
      `[indexed-file] extracted text for id=${indexedFileId} length=${text.length}`,
    );

    if (text) {
      await this.jobService.create(
        'indexed-file-ingest',
        JobPriority.NORMAL,
        {
          indexedFileId: file.id,
          assistantId: file.assistantId,
          content: text,
          filename: file.filename,
          checksum: file.checksum,
        },
      );
    }

    return { success: true, indexedFileId, length: text.length };
  }
}
