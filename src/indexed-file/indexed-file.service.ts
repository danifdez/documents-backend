import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { IndexedFileEntity } from './indexed-file.entity';
import { AssistantEntity } from '../assistant/assistant.entity';
import { JobEntity } from '../job/job.entity';
import { JobStatus } from '../job/job-status.enum';
import { JobService } from '../job/job.service';
import { JobPriority } from '../job/job-priority.enum';
import { sourceIdForIndexedFile } from '../vector/vector-source-id.util';
import {
  detectMimeType,
  resolveSafePath,
  sanitizeFilename,
  relativizeToScope,
} from './path.util';

export type ScanFolderResult =
  | { status: 'no_folder' }
  | { status: 'folder_missing'; folderScope: string }
  | { status: 'done'; added: number; updated: number; removed: number };

export type ReadWithSyncResult =
  | {
      ok: true;
      indexedFileId: number;
      filename: string;
      content: string;
      mimeType: string;
      size: number;
      mtime: Date;
      derivedFromExtraction?: boolean;
    }
  | { ok: false; error: 'not_found'; filename?: string }
  | { ok: false; error: 'ambiguous'; candidates: Array<{ indexedFileId: number; filename: string }> }
  | { ok: false; error: 'not_ready'; filename: string; indexedFileId: number; retryAfterSeconds: number }
  | { ok: false; error: 'not_extractable'; filename: string; indexedFileId: number; mimeType: string };

@Injectable()
export class IndexedFileService {
  private readonly logger = new Logger(IndexedFileService.name);
  private readonly scanLocks = new Map<number, Promise<ScanFolderResult>>();

  constructor(
    @InjectRepository(IndexedFileEntity)
    private readonly repository: Repository<IndexedFileEntity>,
    @InjectRepository(AssistantEntity)
    private readonly assistantRepository: Repository<AssistantEntity>,
    private readonly jobService: JobService,
  ) {}

  async findByAssistant(assistantId: number): Promise<IndexedFileEntity[]> {
    return await this.repository.find({
      where: { assistantId },
      order: { updatedAt: 'DESC' },
    });
  }

  async getById(id: number, assistantId?: number): Promise<IndexedFileEntity> {
    const file = await this.repository.findOne({ where: { id } });
    if (!file) throw new NotFoundException(`IndexedFile ${id} not found`);
    if (assistantId !== undefined && file.assistantId !== assistantId) {
      throw new NotFoundException(`IndexedFile ${id} not found`);
    }
    return file;
  }

  async getByFilename(
    assistantId: number,
    filename: string,
  ): Promise<IndexedFileEntity | null> {
    return await this.repository.findOne({ where: { assistantId, filename } });
  }

  async readContent(
    id: number,
    assistantId?: number,
  ): Promise<{ content: Buffer; mimeType: string; size: number; mtime: Date }> {
    const file = await this.getById(id, assistantId);
    try {
      const buffer = await fs.readFile(file.filePath);
      const stat = await fs.stat(file.filePath);
      return {
        content: buffer,
        mimeType: file.mimeType,
        size: stat.size,
        mtime: stat.mtime,
      };
    } catch (err: any) {
      this.mapFsError(err);
    }
  }

  async writeFile(
    assistantId: number,
    filename: string,
    content: Buffer | string,
    opts: { overwrite: boolean },
  ): Promise<IndexedFileEntity> {
    const folderScope = await this.getFolderScope(assistantId);
    const safeFilename = sanitizeFilename(filename);
    const absolutePath = await resolveSafePath(folderScope, safeFilename);

    const existsOnDisk = await this.pathExists(absolutePath);
    const existingRow = await this.getByFilename(assistantId, safeFilename);

    if ((existsOnDisk || existingRow) && !opts.overwrite) {
      throw new ConflictException('file_exists');
    }

    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;

    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, buffer);
    } catch (err: any) {
      this.mapFsError(err);
    }

    let size: number;
    let mtime: Date;
    try {
      const stat = await fs.stat(absolutePath);
      size = stat.size;
      mtime = stat.mtime;
    } catch (err: any) {
      this.mapFsError(err);
    }

    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const mimeType = detectMimeType(safeFilename);

    const row = existingRow ?? this.repository.create({
      assistantId,
      filename: safeFilename,
      filePath: absolutePath,
      mimeType,
      size,
      mtime,
      checksum,
    });
    row.assistantId = assistantId;
    row.filename = safeFilename;
    row.filePath = absolutePath;
    row.mimeType = mimeType;
    row.size = size;
    row.mtime = mtime;
    row.checksum = checksum;
    row.extractedText = null;
    row.embeddingId = null;

    const saved = await this.repository.save(row);
    await this.enqueueExtraction(saved, buffer);
    return saved;
  }

  private async enqueueExtraction(
    file: IndexedFileEntity,
    buffer: Buffer,
  ): Promise<void> {
    const extension = path.extname(file.filename).toLowerCase() || '';
    try {
      await this.jobService.create(
        'indexed-file-extraction',
        JobPriority.NORMAL,
        {
          indexedFileId: file.id,
          extension,
          checksum: file.checksum,
        },
        undefined,
        buffer,
      );
    } catch (e: any) {
      this.logger.warn(
        `Failed to enqueue extraction for indexed file ${file.id}: ${e?.message ?? e}`,
      );
    }
  }

  async deleteFile(id: number, assistantId?: number): Promise<void> {
    const file = await this.repository.findOne({ where: { id } });
    if (!file) return;
    if (assistantId !== undefined && file.assistantId !== assistantId) {
      throw new NotFoundException(`IndexedFile ${id} not found`);
    }

    try {
      await fs.unlink(file.filePath);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') this.mapFsError(err);
    }

    await this.repository.delete({ id: file.id });

    void this.enqueueVectorCleanup({ sourceId: sourceIdForIndexedFile(file.id) });
  }

  async deleteByFilename(assistantId: number, filename: string): Promise<void> {
    const safe = sanitizeFilename(filename);
    const file = await this.getByFilename(assistantId, safe);
    if (!file) return;
    await this.deleteFile(file.id, assistantId);
  }

  async clearAllForAssistant(assistantId: number): Promise<void> {
    await this.repository.delete({ assistantId });
    void this.enqueueVectorCleanup({ assistantId });
  }

  async hasFolderConfigured(assistantId: number): Promise<boolean> {
    const assistant = await this.assistantRepository.findOne({ where: { id: assistantId } });
    return !!assistant?.folderScope;
  }

  async search(
    assistantId: number,
    query: string,
    limit = 10,
    timeoutMs = 4000,
  ): Promise<Array<{ indexedFileId: number; filename: string; snippet: string; score: number }>> {
    const q = (query ?? '').trim();
    if (!q) return [];

    let job;
    try {
      job = await this.jobService.create(
        'indexed-file-search',
        JobPriority.HIGH,
        { assistantId, query: q, limit },
      );
    } catch (e: any) {
      this.logger.warn(`folder search: failed to enqueue job: ${e?.message ?? e}`);
      return [];
    }
    if (!job) return [];

    const start = Date.now();
    const poll = 100;
    while (Date.now() - start < timeoutMs) {
      const current = (await this.jobService.findOne(job.id)) as JobEntity | null;
      if (!current) return [];
      if (current.status === JobStatus.COMPLETED) {
        const r = current.result as { results?: any[] } | null;
        return Array.isArray(r?.results) ? (r!.results as any[]) : [];
      }
      if (current.status === JobStatus.FAILED) {
        this.logger.warn(`folder search job ${job.id} failed`);
        return [];
      }
      await new Promise((resolve) => setTimeout(resolve, poll));
    }
    this.logger.warn(`folder search job ${job.id} timed out`);
    return [];
  }

  private async enqueueVectorCleanup(args: {
    sourceId?: string;
    indexedFileId?: number;
    assistantId?: number;
  }): Promise<void> {
    try {
      await this.jobService.create(
        'indexed-file-delete-vectors',
        JobPriority.BACKGROUND,
        args,
      );
    } catch (e: any) {
      this.logger.warn(`vector cleanup enqueue failed: ${e?.message ?? e}`);
    }
  }

  async readWithSync(
    assistantId: number,
    ref: { indexedFileId?: number; filename?: string },
  ): Promise<ReadWithSyncResult> {
    let row: IndexedFileEntity | null = null;

    if (typeof ref.indexedFileId === 'number') {
      row = await this.repository.findOne({ where: { id: ref.indexedFileId } });
      if (!row || row.assistantId !== assistantId) {
        return { ok: false, error: 'not_found' };
      }
    } else if (ref.filename) {
      const requested = ref.filename;
      const exact = await this.repository.findOne({
        where: { assistantId, filename: requested },
      });
      if (exact) {
        row = exact;
      } else {
        const all = await this.repository.find({ where: { assistantId } });
        const base = path.basename(requested);
        const matches = all.filter((r) => path.basename(r.filename) === base);
        if (matches.length === 1) {
          row = matches[0];
        } else if (matches.length > 1) {
          return {
            ok: false,
            error: 'ambiguous',
            candidates: matches.map((m) => ({
              indexedFileId: m.id,
              filename: m.filename,
            })),
          };
        } else {
          const onDisk = await this.tryAdoptFromDisk(assistantId, requested);
          if (!onDisk) return { ok: false, error: 'not_found', filename: requested };
          row = onDisk;
        }
      }
    } else {
      return { ok: false, error: 'not_found' };
    }

    let stat;
    try {
      stat = await fs.stat(row.filePath);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        await this.repository.delete({ id: row.id });
        void this.enqueueVectorCleanup({ sourceId: sourceIdForIndexedFile(row.id) });
        return { ok: false, error: 'not_found', filename: row.filename };
      }
      this.mapFsError(err);
    }

    const sizeDiffers = Number(row.size) !== stat.size;
    const mtimeDiffers = row.mtime.getTime() !== stat.mtime.getTime();
    let buffer: Buffer | null = null;

    if (sizeDiffers || mtimeDiffers) {
      buffer = await this.readFileSafe(row.filePath);
      if (buffer === null) {
        return { ok: false, error: 'not_found', filename: row.filename };
      }
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
      if (checksum !== row.checksum) {
        row.size = stat.size;
        row.mtime = stat.mtime;
        row.checksum = checksum;
        row.extractedText = null;
        row.embeddingId = null;
        row = await this.repository.save(row);
        void this.enqueueVectorCleanup({ sourceId: sourceIdForIndexedFile(row.id) });
        await this.enqueueExtraction(row, buffer);
      } else {
        row.mtime = stat.mtime;
        row = await this.repository.save(row);
      }
    }

    const isTextual = this.isTextual(row.mimeType);
    if (isTextual) {
      if (!buffer) {
        buffer = await this.readFileSafe(row.filePath);
        if (buffer === null) return { ok: false, error: 'not_found', filename: row.filename };
      }
      return {
        ok: true,
        indexedFileId: row.id,
        filename: row.filename,
        content: buffer.toString('utf-8'),
        mimeType: row.mimeType,
        size: stat.size,
        mtime: stat.mtime,
      };
    }

    if (row.extractedText === null) {
      return {
        ok: false,
        error: 'not_ready',
        filename: row.filename,
        indexedFileId: row.id,
        retryAfterSeconds: 5,
      };
    }
    if (row.extractedText === '') {
      return {
        ok: false,
        error: 'not_extractable',
        filename: row.filename,
        indexedFileId: row.id,
        mimeType: row.mimeType,
      };
    }
    return {
      ok: true,
      indexedFileId: row.id,
      filename: row.filename,
      content: row.extractedText,
      mimeType: 'text/plain; charset=utf-8',
      size: stat.size,
      mtime: stat.mtime,
      derivedFromExtraction: true,
    };
  }

  private isTextual(mimeType: string): boolean {
    if (!mimeType) return false;
    const m = mimeType.toLowerCase();
    return (
      m.startsWith('text/') ||
      m === 'application/json' ||
      m === 'application/xml'
    );
  }

  private async tryAdoptFromDisk(
    assistantId: number,
    requested: string,
  ): Promise<IndexedFileEntity | null> {
    const folderScope = await this.getFolderScope(assistantId);
    let safeFilename: string;
    let absolute: string;
    try {
      safeFilename = sanitizeFilename(requested);
      absolute = await resolveSafePath(folderScope, safeFilename);
    } catch {
      return null;
    }
    const exists = await this.pathExists(absolute);
    if (!exists) return null;
    const buffer = await this.readFileSafe(absolute);
    if (!buffer) return null;
    const stat = await fs.stat(absolute);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const created = this.repository.create({
      assistantId,
      filename: safeFilename,
      filePath: absolute,
      mimeType: detectMimeType(safeFilename),
      size: stat.size,
      mtime: stat.mtime,
      checksum,
      extractedText: null,
      embeddingId: null,
    });
    const saved = await this.repository.save(created);
    await this.enqueueExtraction(saved, buffer);
    return saved;
  }

  async scanFolder(assistantId: number): Promise<ScanFolderResult> {
    const existing = this.scanLocks.get(assistantId);
    if (existing) return await existing;
    const promise = this.doScanFolder(assistantId).finally(() => {
      this.scanLocks.delete(assistantId);
    });
    this.scanLocks.set(assistantId, promise);
    return await promise;
  }

  private async doScanFolder(assistantId: number): Promise<ScanFolderResult> {
    const assistant = await this.assistantRepository.findOne({ where: { id: assistantId } });
    if (!assistant) throw new NotFoundException(`Assistant ${assistantId} not found`);
    if (!assistant.folderScope) return { status: 'no_folder' };

    const folderScope = assistant.folderScope;

    let entries: any[];
    try {
      entries = (await fs.readdir(folderScope, {
        withFileTypes: true,
        recursive: true,
      } as any)) as any[];
    } catch (err: any) {
      if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') {
        this.logger.warn(
          `[indexed-file] folder missing for assistant=${assistantId} path=${folderScope}`,
        );
        return { status: 'folder_missing', folderScope };
      }
      throw err;
    }

    type FsItem = { filename: string; filePath: string; mtime: Date; size: number };
    const onDisk = new Map<string, FsItem>();

    for (const entry of entries as any[]) {
      if (!entry.isFile?.()) continue;
      const parent: string = entry.parentPath ?? entry.path ?? folderScope;
      const absolute = path.resolve(parent, entry.name);
      let relative: string;
      try {
        relative = relativizeToScope(folderScope, absolute);
      } catch {
        continue;
      }
      try {
        const stat = await fs.stat(absolute);
        onDisk.set(relative, {
          filename: relative,
          filePath: absolute,
          mtime: stat.mtime,
          size: stat.size,
        });
      } catch (err: any) {
        if (err?.code === 'EACCES') {
          this.logger.warn(`[indexed-file] skip unreadable file: ${absolute}`);
          continue;
        }
        throw err;
      }
    }

    const indexed = await this.repository.find({ where: { assistantId } });
    const indexedByName = new Map(indexed.map((row) => [row.filename, row]));

    let added = 0;
    let updated = 0;
    let removed = 0;

    for (const [filename, item] of onDisk) {
      const row = indexedByName.get(filename);
      if (!row) {
        const buffer = await this.readFileSafe(item.filePath);
        if (buffer === null) continue;
        const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
        const created = this.repository.create({
          assistantId,
          filename,
          filePath: item.filePath,
          mimeType: detectMimeType(filename),
          size: item.size,
          mtime: item.mtime,
          checksum,
          extractedText: null,
          embeddingId: null,
        });
        const saved = await this.repository.save(created);
        await this.enqueueExtraction(saved, buffer);
        added += 1;
        continue;
      }
      const mtimeDiffers = row.mtime.getTime() !== item.mtime.getTime();
      const sizeDiffers = Number(row.size) !== item.size;
      if (mtimeDiffers || sizeDiffers) {
        const buffer = await this.readFileSafe(item.filePath);
        if (buffer === null) continue;
        const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
        if (checksum !== row.checksum) {
          row.size = item.size;
          row.mtime = item.mtime;
          row.checksum = checksum;
          row.filePath = item.filePath;
          row.mimeType = detectMimeType(filename);
          row.extractedText = null;
          row.embeddingId = null;
          const saved = await this.repository.save(row);
          await this.enqueueExtraction(saved, buffer);
          updated += 1;
        } else {
          row.mtime = item.mtime;
          await this.repository.save(row);
        }
      }
    }

    for (const row of indexed) {
      if (!onDisk.has(row.filename)) {
        await this.repository.delete({ id: row.id });
        removed += 1;
      }
    }

    this.logger.log(
      `[indexed-file] reconcile assistant=${assistantId} added=${added} updated=${updated} removed=${removed}`,
    );
    return { status: 'done', added, updated, removed };
  }

  private async readFileSafe(filePath: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(filePath);
    } catch (err: any) {
      if (err?.code === 'EACCES' || err?.code === 'ENOENT') {
        this.logger.warn(`[indexed-file] cannot read ${filePath}: ${err.code}`);
        return null;
      }
      throw err;
    }
  }

  private async getFolderScope(assistantId: number): Promise<string> {
    const assistant = await this.assistantRepository.findOne({
      where: { id: assistantId },
    });
    if (!assistant) throw new NotFoundException(`Assistant ${assistantId} not found`);
    if (!assistant.folderScope) {
      throw new ConflictException('no_folder_configured');
    }
    return assistant.folderScope;
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private mapFsError(err: any): never {
    if (err instanceof ForbiddenException) throw err;
    if (err instanceof ConflictException) throw err;
    if (err instanceof NotFoundException) throw err;
    if (err?.code === 'EACCES') {
      throw new ForbiddenException('No permission to access the file');
    }
    this.logger.error(`Filesystem error: ${err?.message ?? err}`);
    throw new InternalServerErrorException(err?.message ?? 'Filesystem error');
  }
}
