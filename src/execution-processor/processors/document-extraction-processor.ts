import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionPriority } from '../../execution/execution-priority.enum';
import { ResourceEntity } from '../../resource/resource.entity';
import { ExecutionService } from '../../execution/execution.service';
import { ExecutionEntity } from '../../execution/execution.entity';
import { FileStorageService } from '../../file-storage/file-storage.service';
import { ExecutionEffectJournalService } from '../../execution/execution-effect-journal.service';
import {
  canonicalHash,
  contentHash,
} from '../../execution/execution-canonical';

class DocumentExtractionResourceNotFoundError extends Error {}
class DocumentExtractionResourceChangedError extends Error {}

const MEDIA_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  '.wma',
  '.opus',
  '.aiff',
  '.aif',
  '.mp4',
  '.m4v',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.wmv',
]);

@Injectable()
export class DocumentExtractionProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(DocumentExtractionProcessor.name);
  private readonly TASK_TYPE = 'document-extraction';

  constructor(
    private readonly executionService: ExecutionService,
    private readonly fileStorageService: FileStorageService,
    private readonly effectJournal: ExecutionEffectJournalService,
  ) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const hash = execution.payload['hash'] as string;
    const extension = execution.payload['extension'] as string;
    const resourceId = Number(execution.payload['resourceId']) as number;
    const result = execution.result as Record<string, unknown> | null;

    if (!hash || !extension || !resourceId || !result) {
      throw new Error(
        'Execution payload missing required parameters (hash, extension, resourceId, or result)',
      );
    }

    const title = this.optionalString(result.title, 'title');
    const author = this.optionalString(result.author, 'author');
    const publicationDate = this.optionalString(
      result.publication_date,
      'publication_date',
    );
    if (typeof result.content !== 'string') {
      throw new Error('document-extraction result content is invalid');
    }
    const content = result.content;
    const pages = this.optionalPages(result.pages);
    const isMedia = MEDIA_EXTENSIONS.has(extension.toLowerCase());
    const status = isMedia ? 'transcribing' : 'extracted';
    const extractedContentHash = contentHash(content);

    try {
      await this.effectJournal.runVerified(
        {
          executionId: execution.executionId,
          effectKey: `document-extraction:${resourceId}`,
          effectType: 'resource_extraction_replace',
          resourceKey: `resource:${resourceId}`,
          intent: {
            resourceId,
            hash,
            title,
            author,
            publicationDate,
            extractedContentHash,
            pages,
            status,
          },
        },
        async (manager) => {
          const repository = manager.getRepository(ResourceEntity);
          const resource = await repository.findOne({
            where: { id: resourceId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!resource) throw new DocumentExtractionResourceNotFoundError();
          if (resource.hash !== hash) {
            throw new DocumentExtractionResourceChangedError();
          }
          const beforeHash = canonicalHash({
            title: resource.title,
            publicationDate: resource.publicationDate,
            contentHash: contentHash(resource.content ?? ''),
            pages: resource.pages,
            status: resource.status,
          });
          resource.title = title;
          resource.publicationDate = publicationDate;
          resource.content = content;
          resource.status = status;
          if (pages !== undefined) resource.pages = pages;
          await repository.save(resource);
          const authorId = author
            ? await this.linkExtractedAuthor(manager, resourceId, author)
            : null;
          const observed = await repository.findOneBy({ id: resourceId });
          const expectedPages = pages ?? resource.pages;
          if (
            observed?.title !== title ||
            observed.publicationDate !== publicationDate ||
            observed.content !== content ||
            observed.pages !== expectedPages ||
            observed.status !== status
          ) {
            throw new Error('document_extraction_effect_not_verified');
          }
          return {
            resourceId,
            beforeHash,
            afterHash: canonicalHash({
              title,
              publicationDate,
              contentHash: extractedContentHash,
              pages: expectedPages,
              status,
            }),
            authorId,
          };
        },
      );
    } catch (error) {
      if (error instanceof DocumentExtractionResourceNotFoundError) {
        return { success: false, reason: 'not_found' };
      }
      if (error instanceof DocumentExtractionResourceChangedError) {
        return { success: false, reason: 'stale' };
      }
      throw error;
    }

    if (isMedia) {
      const relativePath = this.fileStorageService.getRelativePath(
        hash,
        extension,
      );
      const buffer = await this.fileStorageService.getFile(relativePath);
      if (!buffer) {
        throw new Error(`Audio file not found for transcribe: ${relativePath}`);
      }
      await this.executionService.createInference(
        'transcribe',
        ExecutionPriority.BACKGROUND,
        {
          hash,
          extension,
          resourceId,
        },
        {
          rootExecutionId: execution.rootExecutionId,
          parentExecutionId: execution.executionId,
          ownerPrincipal: execution.ownerPrincipal,
          childIdempotencyKey:
            `document-extraction:transcribe:${resourceId}:` + hash,
          inputArtifacts: [
            {
              role: 'media',
              kind: 'source_media',
              mediaType: 'application/octet-stream',
              body: buffer,
            },
          ],
        },
      );
    }

    return {
      success: true,
      resourceId,
      status,
      publication: {
        socketEvent: 'notification',
        payload: {
          type: 'document-extraction',
          message: isMedia
            ? `Media extraction completed for resource with hash ${hash}. ` +
              'Transcription scheduled.'
            : `Document extraction completed for resource with hash ${hash}. ` +
              'Ready for confirmation.',
          resourceId,
        },
      },
    };
  }

  private optionalString(value: unknown, field: string): string | null {
    if (value == null) return null;
    if (typeof value !== 'string') {
      throw new Error(`document-extraction result ${field} is invalid`);
    }
    const normalized = value.trim();
    return normalized || null;
  }

  private optionalPages(value: unknown): number | undefined {
    if (value == null) return undefined;
    const pages = Number(value);
    if (!Number.isInteger(pages) || pages < 0) {
      throw new Error('document-extraction result pages is invalid');
    }
    return pages;
  }

  private async linkExtractedAuthor(
    manager: {
      query: (query: string, parameters: unknown[]) => Promise<any[]>;
    },
    resourceId: number,
    author: string,
  ): Promise<number> {
    const inserted = await manager.query(
      `INSERT INTO authors (name)
       VALUES ($1)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [author],
    );
    const existing = inserted[0]
      ? inserted
      : await manager.query(
          'SELECT id FROM authors WHERE LOWER(name) = LOWER($1)',
          [author],
        );
    const authorId = Number(existing[0]?.id);
    if (!Number.isInteger(authorId) || authorId <= 0) {
      throw new Error('document_extraction_author_not_persisted');
    }
    await manager.query(
      `INSERT INTO resource_authors (resource_id, author_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [resourceId, authorId],
    );
    const links = await manager.query(
      `SELECT author.id, author.name
       FROM authors author
       JOIN resource_authors link ON link.author_id = author.id
       WHERE link.resource_id = $1 AND author.id = $2`,
      [resourceId, authorId],
    );
    if (
      links.length !== 1 ||
      String(links[0].name).toLowerCase() !== author.toLowerCase()
    ) {
      throw new Error('document_extraction_author_effect_not_verified');
    }
    return authorId;
  }
}
