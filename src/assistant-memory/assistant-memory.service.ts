import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemoryEntryEntity } from './memory-entry.entity';
import { AssistantEntity } from '../assistant/assistant.entity';
import { CreateMemoryEntryDto, UpdateMemoryEntryDto } from './dto/memory.dto';

@Injectable()
export class AssistantMemoryService {
  constructor(
    @InjectRepository(MemoryEntryEntity)
    private readonly memoryRepo: Repository<MemoryEntryEntity>,
    @InjectRepository(AssistantEntity)
    private readonly assistantRepo: Repository<AssistantEntity>,
  ) {}

  private async ensureCanHaveMemory(assistantId: number): Promise<AssistantEntity> {
    const a = await this.assistantRepo.findOne({ where: { id: assistantId } });
    if (!a) throw new NotFoundException(`Assistant ${assistantId} not found`);
    if (!a.isSystem) {
      throw new ForbiddenException('Only the personal assistant has memory.');
    }
    return a;
  }

  async list(assistantId: number): Promise<MemoryEntryEntity[]> {
    await this.ensureCanHaveMemory(assistantId);
    return this.memoryRepo.find({
      where: { assistantId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  /**
   * Returns the N most recent entries — used by the chat pipeline to inject
   * memory into the worker payload. Returns [] if the assistant doesn't have
   * memory (instead of throwing) so callers can use it unconditionally.
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

  async create(assistantId: number, dto: CreateMemoryEntryDto): Promise<MemoryEntryEntity> {
    await this.ensureCanHaveMemory(assistantId);
    const created = this.memoryRepo.create({
      assistantId,
      name: dto.name.trim(),
      type: dto.type,
      body: dto.body.trim(),
      source: 'manual',
    });
    return this.memoryRepo.save(created);
  }

  async update(assistantId: number, id: number, dto: UpdateMemoryEntryDto): Promise<MemoryEntryEntity> {
    await this.ensureCanHaveMemory(assistantId);
    const entry = await this.memoryRepo.findOne({ where: { id, assistantId } });
    if (!entry) throw new NotFoundException(`Memory entry ${id} not found`);
    if (dto.name !== undefined) entry.name = dto.name.trim();
    if (dto.type !== undefined) entry.type = dto.type;
    if (dto.body !== undefined) entry.body = dto.body.trim();
    return this.memoryRepo.save(entry);
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
    await this.memoryRepo.remove(entry);
  }

  async clear(assistantId: number): Promise<{ deleted: number }> {
    await this.ensureCanHaveMemory(assistantId);
    const res = await this.memoryRepo.delete({ assistantId });
    return { deleted: res.affected ?? 0 };
  }
}
