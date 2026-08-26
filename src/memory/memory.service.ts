import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentEntity } from '../agent/agent.entity';
import { AssistantEntity } from '../assistant/assistant.entity';
import { canonicalHash } from '../execution/execution-canonical';
import { CreateMemoryEntryDto, UpdateMemoryEntryDto } from './dto/memory.dto';
import { MemoryEntryEntity } from './memory-entry.entity';

export type MemoryOwnerType = 'assistant' | 'agent';

@Injectable()
export class MemoryService {
  constructor(
    @InjectRepository(MemoryEntryEntity)
    private readonly memoryRepo: Repository<MemoryEntryEntity>,
    @InjectRepository(AssistantEntity)
    private readonly assistantRepo: Repository<AssistantEntity>,
    @InjectRepository(AgentEntity)
    private readonly agentRepo: Repository<AgentEntity>,
  ) {}

  async list(
    ownerType: MemoryOwnerType,
    ownerId: number,
  ): Promise<MemoryEntryEntity[]> {
    await this.ensureOwner(ownerType, ownerId);
    return this.memoryRepo.find({
      where: this.ownerWhere(ownerType, ownerId),
      order: { updatedAt: 'DESC', id: 'ASC' },
    });
  }

  async create(
    ownerType: MemoryOwnerType,
    ownerId: number,
    dto: CreateMemoryEntryDto,
  ): Promise<MemoryEntryEntity> {
    await this.ensureOwner(ownerType, ownerId);
    const values = this.normalized(dto);
    const now = new Date();
    return this.memoryRepo.save(
      this.memoryRepo.create({
        ...this.ownerWhere(ownerType, ownerId),
        ...values,
        contentHash: canonicalHash(values),
        sourceKind: 'manual',
        sourceExecutionId: null,
        sourceTurnId: null,
        sourceMessageId: null,
        sourceArtifactId: null,
        sourceArtifactRevision: null,
        consentStatus: 'granted',
        consentBasis: 'explicit_user_action',
        consentedAt: now,
        dataClassification: 'workspace',
        purpose: 'conversation_memory',
        allowedDestinations: ['documents', 'documents-models'],
      }),
    );
  }

  async update(
    ownerType: MemoryOwnerType,
    ownerId: number,
    id: string,
    dto: UpdateMemoryEntryDto,
  ): Promise<MemoryEntryEntity> {
    await this.ensureOwner(ownerType, ownerId);
    const entry = await this.memoryRepo.findOne({
      where: { id, ...this.ownerWhere(ownerType, ownerId) },
    });
    if (!entry) throw new NotFoundException(`Memory entry ${id} not found`);
    const values = this.normalized({
      name: dto.name ?? entry.name,
      type: dto.type ?? entry.type,
      body: dto.body ?? entry.body,
    });
    Object.assign(entry, values, {
      contentHash: canonicalHash(values),
      sourceKind: 'manual',
      sourceExecutionId: null,
      sourceTurnId: null,
      sourceMessageId: null,
      sourceArtifactId: null,
      sourceArtifactRevision: null,
      consentStatus: 'granted',
      consentBasis: 'explicit_user_action',
      consentedAt: new Date(),
    });
    return this.memoryRepo.save(entry);
  }

  async remove(
    ownerType: MemoryOwnerType,
    ownerId: number,
    id: string,
  ): Promise<void> {
    await this.ensureOwner(ownerType, ownerId);
    const result = await this.memoryRepo.delete({
      id,
      ...this.ownerWhere(ownerType, ownerId),
    });
    if (!result.affected)
      throw new NotFoundException(`Memory entry ${id} not found`);
  }

  async clear(
    ownerType: MemoryOwnerType,
    ownerId: number,
  ): Promise<{ deleted: number }> {
    await this.ensureOwner(ownerType, ownerId);
    const result = await this.memoryRepo.delete(
      this.ownerWhere(ownerType, ownerId),
    );
    return { deleted: result.affected ?? 0 };
  }

  private ownerWhere(
    ownerType: MemoryOwnerType,
    ownerId: number,
  ): Pick<MemoryEntryEntity, 'assistantId' | 'agentId'> {
    return ownerType === 'assistant'
      ? { assistantId: ownerId, agentId: null }
      : { assistantId: null, agentId: ownerId };
  }

  private async ensureOwner(
    ownerType: MemoryOwnerType,
    ownerId: number,
  ): Promise<void> {
    const owner =
      ownerType === 'assistant'
        ? await this.assistantRepo.findOneBy({ id: ownerId })
        : await this.agentRepo.findOneBy({ id: ownerId });
    if (!owner)
      throw new NotFoundException(`${ownerType} ${ownerId} not found`);
  }

  private normalized(dto: CreateMemoryEntryDto): CreateMemoryEntryDto {
    return { name: dto.name.trim(), type: dto.type, body: dto.body.trim() };
  }
}
