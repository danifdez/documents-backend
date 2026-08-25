import { Injectable } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { VectorStoreService } from '../../vector/vector-store.service';

@Injectable()
export class MemoryIngestProcessor implements ExecutionProcessor {
  constructor(private readonly vectorStore: VectorStoreService) {}

  canProcess(taskType: string): boolean {
    return taskType === 'memory-ingest';
  }

  async process(
    execution: ExecutionEntity,
  ): Promise<{ success: true; memoryId: number }> {
    const memoryId = Number(execution.payload['memoryId']);
    const assistantId = Number(execution.payload['ownerId']);
    const result = execution.result as Record<string, unknown> | null;
    if (
      !Number.isInteger(memoryId) ||
      memoryId <= 0 ||
      !Number.isInteger(assistantId) ||
      assistantId <= 0 ||
      !Array.isArray(result?.embedding)
    ) {
      throw new Error('memory-ingest result is invalid');
    }
    await this.vectorStore.replaceMemory(
      memoryId,
      assistantId,
      result.embedding as number[],
      {
        memory_id: memoryId,
        name: String(execution.payload['name'] ?? ''),
        type: String(execution.payload['type'] ?? 'fact'),
      },
    );
    return { success: true, memoryId };
  }
}
