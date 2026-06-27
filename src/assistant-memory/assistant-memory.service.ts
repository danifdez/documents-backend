import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MemoryEntryEntity } from './memory-entry.entity';
import { AssistantEntity } from '../assistant/assistant.entity';
import { CreateMemoryEntryDto, UpdateMemoryEntryDto } from './dto/memory.dto';
import { JobService } from '../job/job.service';
import { JobPriority } from '../job/job-priority.enum';
import { JobStatus } from '../job/job-status.enum';
import { JobEntity } from '../job/job.entity';

export type MemoryRelevance = 'high' | 'medium' | 'recent';

export type MemoryEntryWithRelevance = MemoryEntryEntity & {
  relevance: MemoryRelevance;
};

@Injectable()
export class AssistantMemoryService {
  private readonly logger = new Logger(AssistantMemoryService.name);

  constructor(
    @InjectRepository(MemoryEntryEntity)
    private readonly memoryRepo: Repository<MemoryEntryEntity>,
    @InjectRepository(AssistantEntity)
    private readonly assistantRepo: Repository<AssistantEntity>,
    private readonly jobService: JobService,
  ) {}

  private async ensureCanHaveMemory(assistantId: number): Promise<AssistantEntity> {
    const a = await this.assistantRepo.findOne({ where: { id: assistantId } });
    if (!a) throw new NotFoundException(`Assistant ${assistantId} not found`);
    if (!a.isSystem) {
      throw new ForbiddenException('Only the personal assistant has memory.');
    }
    return a;
  }

  private async enqueueIngest(entry: MemoryEntryEntity): Promise<void> {
    try {
      await this.jobService.create('memory-ingest', JobPriority.BACKGROUND, {
        memoryId: entry.id,
        assistantId: entry.assistantId,
        name: entry.name,
        type: entry.type,
        body: entry.body,
      });
    } catch (e: any) {
      this.logger.warn(
        `memory-ingest enqueue failed for memory ${entry.id}: ${e?.message ?? e}`,
      );
    }
  }

  async list(assistantId: number): Promise<MemoryEntryEntity[]> {
    await this.ensureCanHaveMemory(assistantId);
    return this.memoryRepo.find({
      where: { assistantId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  /**
   * Returns the N most recent entries — used as a fallback (trivial query,
   * worker unavailable) and as the "recent" block of `relevantForInjection`.
   * Returns [] if the assistant doesn't have memory (instead of throwing) so
   * callers can use it unconditionally.
   */
  async recentForInjection(assistantId: number, limit = 25): Promise<MemoryEntryEntity[]> {
    const a = await this.assistantRepo.findOne({ where: { id: assistantId } });
    if (!a || !a.isSystem) return [];
    return this.memoryRepo.find({
      where: { assistantId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
    });
  }

  private async runMemorySearch(
    assistantId: number,
    query: string,
    limit: number,
    timeoutMs = 3000,
  ): Promise<Array<{ memoryId: number; score: number }>> {
    let job;
    try {
      job = await this.jobService.create('memory-search', JobPriority.HIGH, {
        assistantId,
        query,
        limit,
      });
    } catch (e: any) {
      this.logger.warn(`memory-search enqueue failed: ${e?.message ?? e}`);
      return [];
    }
    if (!job) return [];

    const start = Date.now();
    const poll = 100;
    while (Date.now() - start < timeoutMs) {
      const current = (await this.jobService.findOne(job.id)) as JobEntity | null;
      if (!current) return [];
      if (current.status === JobStatus.COMPLETED) {
        const r = current.result as
          | { results?: Array<{ memoryId: number; score: number }> }
          | null;
        return Array.isArray(r?.results) ? r!.results : [];
      }
      if (current.status === JobStatus.FAILED) {
        this.logger.warn(`memory-search job ${job.id} failed`);
        return [];
      }
      await new Promise((resolve) => setTimeout(resolve, poll));
    }
    this.logger.warn(`memory-search job ${job.id} timed out`);
    return [];
  }

  /**
   * Returns memories likely to be relevant to the user's current message,
   * mixed with the most recent ones. Each entry carries a `relevance` tag so
   * the worker prompt can prioritise high-similarity hits for actions like
   * `replace`.
   *
   * Falls back to `recentForInjection` when the query is empty, too short
   * (<8 chars after trim) or when the semantic search yields nothing — so
   * trivial messages (greetings, very short questions) do not pull memories
   * by spurious similarity.
   */
  async relevantForInjection(
    assistantId: number,
    query: string,
    limit = 8,
  ): Promise<MemoryEntryWithRelevance[]> {
    const a = await this.assistantRepo.findOne({ where: { id: assistantId } });
    if (!a || !a.isSystem) return [];

    const cleanQuery = (query ?? '').trim();
    const recentLimit = 5;
    const cap = 12;

    if (cleanQuery.length < 8) {
      const recents = await this.recentForInjection(assistantId, recentLimit);
      return recents.map((m) =>
        Object.assign(m, { relevance: 'recent' as const }),
      );
    }

    const hits = await this.runMemorySearch(assistantId, cleanQuery, limit);
    const recents = await this.recentForInjection(assistantId, recentLimit);

    const semanticIds = hits.map((h) => h.memoryId);
    const semanticEntities = semanticIds.length
      ? await this.memoryRepo.find({
          where: { id: In(semanticIds), assistantId },
        })
      : [];
    const byId = new Map(semanticEntities.map((e) => [e.id, e]));

    const semanticEntries: MemoryEntryWithRelevance[] = [];
    for (const h of hits) {
      const e = byId.get(h.memoryId);
      if (!e) continue;
      const relevance: 'high' | 'medium' = h.score > 0.85 ? 'high' : 'medium';
      semanticEntries.push(Object.assign(e, { relevance }));
    }

    const seen = new Set<number>(semanticEntries.map((e) => e.id));
    const merged: MemoryEntryWithRelevance[] = [...semanticEntries];
    for (const r of recents) {
      if (seen.has(r.id)) continue;
      merged.push(Object.assign(r, { relevance: 'recent' as const }));
      seen.add(r.id);
      if (merged.length >= cap) break;
    }

    return merged.slice(0, cap);
  }

  async create(assistantId: number, dto: CreateMemoryEntryDto): Promise<MemoryEntryEntity> {
    await this.ensureCanHaveMemory(assistantId);
    const created = this.memoryRepo.create({
      assistantId,
      name: dto.name.trim(),
      type: dto.type,
      body: dto.body.trim(),
      source: 'manual',
    });
    const saved = await this.memoryRepo.save(created);
    void this.enqueueIngest(saved);
    return saved;
  }

  async update(assistantId: number, id: number, dto: UpdateMemoryEntryDto): Promise<MemoryEntryEntity> {
    await this.ensureCanHaveMemory(assistantId);
    const entry = await this.memoryRepo.findOne({ where: { id, assistantId } });
    if (!entry) throw new NotFoundException(`Memory entry ${id} not found`);
    if (dto.name !== undefined) entry.name = dto.name.trim();
    if (dto.type !== undefined) entry.type = dto.type;
    if (dto.body !== undefined) entry.body = dto.body.trim();
    const saved = await this.memoryRepo.save(entry);
    void this.enqueueIngest(saved);
    return saved;
  }

  /**
   * Returns the entry if it belongs to this assistant, or null otherwise.
   * Used by the chat processor to look up an entry before deleting it so the
   * event card can include its name. Does not throw — caller checks for null.
   */
  async findOwned(assistantId: number, id: number): Promise<MemoryEntryEntity | null> {
    return this.memoryRepo.findOne({ where: { id, assistantId } });
  }

  async remove(assistantId: number, id: number): Promise<void> {
    await this.ensureCanHaveMemory(assistantId);
    const entry = await this.memoryRepo.findOne({ where: { id, assistantId } });
    if (!entry) throw new NotFoundException(`Memory entry ${id} not found`);
    // The memory vector is removed automatically: memory_vectors.memory_id is a
    // FK to assistant_memory_entries(id) ON DELETE CASCADE.
    await this.memoryRepo.remove(entry);
  }

  async clear(assistantId: number): Promise<{ deleted: number }> {
    await this.ensureCanHaveMemory(assistantId);
    // Deleting the entries cascades to their memory_vectors rows.
    const res = await this.memoryRepo.delete({ assistantId });
    return { deleted: res.affected ?? 0 };
  }
}
