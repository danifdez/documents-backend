import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { MemoryEntryEntity } from '../../assistant-memory/memory-entry.entity';
import { IndexedFileEntity } from '../../indexed-file/indexed-file.entity';

@Injectable()
export class VectorSearchProcessor implements ExecutionProcessor {
  private readonly taskTypes = new Set([
    'memory-search',
    'indexed-file-search',
  ]);

  constructor(
    @InjectRepository(MemoryEntryEntity)
    private readonly memoryRepository: Repository<MemoryEntryEntity>,
    @InjectRepository(IndexedFileEntity)
    private readonly indexedFileRepository: Repository<IndexedFileEntity>,
  ) {}

  canProcess(taskType: string): boolean {
    return this.taskTypes.has(taskType);
  }

  async process(
    execution: ExecutionEntity,
  ): Promise<{ success: true; resultCount: number }> {
    const result = execution.result as Record<string, unknown> | null;
    if (!Array.isArray(result?.results)) {
      throw new Error(`${execution.taskType} result requires results`);
    }
    if (execution.taskType === 'memory-search') {
      await this.validateMemoryResults(execution, result.results);
    } else {
      await this.validateIndexedFileResults(execution, result.results);
    }
    return { success: true, resultCount: result.results.length };
  }

  private async validateMemoryResults(
    execution: ExecutionEntity,
    results: unknown[],
  ): Promise<void> {
    const ownerId = this.positiveId(execution.payload['ownerId']);
    const ids = this.resultIds(results, 'memoryId');
    if (!ids.length) return;
    const rows = await this.memoryRepository.find({
      where: { id: In(ids), assistantId: ownerId },
      select: ['id'],
    });
    this.assertSameIds(
      ids,
      rows.map((row) => row.id),
      'memory-search',
    );
  }

  private async validateIndexedFileResults(
    execution: ExecutionEntity,
    results: unknown[],
  ): Promise<void> {
    const ownerId = this.positiveId(execution.payload['ownerId']);
    const ownerType = execution.payload['ownerType'];
    if (ownerType !== 'agent') {
      throw new Error('indexed-file-search ownerType is invalid');
    }
    const ids = this.resultIds(results, 'indexedFileId');
    if (!ids.length) return;
    const rows = await this.indexedFileRepository.find({
      where: { id: In(ids), ownerId, ownerType },
      select: ['id'],
    });
    this.assertSameIds(
      ids,
      rows.map((row) => row.id),
      'indexed-file-search',
    );
  }

  private resultIds(results: unknown[], field: string): number[] {
    const ids = results.map((result) => {
      if (!result || typeof result !== 'object') {
        throw new Error(`Vector search result requires ${field}`);
      }
      const id = this.positiveId((result as Record<string, unknown>)[field]);
      const score = (result as Record<string, unknown>)['score'];
      if (typeof score !== 'number' || !Number.isFinite(score)) {
        throw new Error('Vector search result score is invalid');
      }
      return id;
    });
    return [...new Set(ids)];
  }

  private positiveId(value: unknown): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Vector search identity is invalid');
    }
    return id;
  }

  private assertSameIds(
    expected: number[],
    actual: number[],
    taskType: string,
  ): void {
    const actualIds = new Set(actual);
    if (expected.some((id) => !actualIds.has(id))) {
      throw new Error(`${taskType} result is outside its owner scope`);
    }
  }
}
