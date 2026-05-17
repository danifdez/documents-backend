import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobProcessor } from '../job-processor.interface';
import { JobEntity } from 'src/job/job.entity';
import { IndexedFileEntity } from 'src/indexed-file/indexed-file.entity';
import { sourceIdForIndexedFile } from 'src/vector/vector-source-id.util';

@Injectable()
export class IndexedFileIngestProcessor implements JobProcessor {
  private readonly logger = new Logger(IndexedFileIngestProcessor.name);
  private readonly JOB_TYPE = 'indexed-file-ingest';

  constructor(
    @InjectRepository(IndexedFileEntity)
    private readonly repository: Repository<IndexedFileEntity>,
  ) {}

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const indexedFileId = Number(job.payload['indexedFileId']);
    if (!indexedFileId) {
      throw new Error('indexed-file-ingest job missing indexedFileId');
    }

    const file = await this.repository.findOne({ where: { id: indexedFileId } });
    if (!file) {
      this.logger.warn(`IndexedFile ${indexedFileId} no longer exists; skipping`);
      return { success: false, reason: 'not_found' };
    }

    const jobChecksum = job.payload['checksum'] as string | undefined;
    if (jobChecksum && jobChecksum !== file.checksum) {
      this.logger.log(
        `[indexed-file] discarding stale ingest for id=${indexedFileId} (checksum changed)`,
      );
      return { success: false, reason: 'stale' };
    }

    const result = job.result as { chunks?: number; sourceId?: string } | null;
    const chunks = Number(result?.chunks ?? 0);

    file.embeddingId = chunks > 0 ? sourceIdForIndexedFile(file.id) : null;
    await this.repository.save(file);

    this.logger.log(
      `[indexed-file] ingested vectors id=${indexedFileId} chunks=${chunks}`,
    );

    return { success: true, indexedFileId, chunks };
  }
}
