import { Injectable } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from '../../execution/execution.entity';
import { VectorStoreService } from '../../vector/vector-store.service';
import { ExecutionArtifactService } from '../../execution/execution-artifact.service';

@Injectable()
export class MemoryIngestProcessor implements ExecutionProcessor {
  constructor(
    private readonly vectorStore: VectorStoreService,
    private readonly artifacts: ExecutionArtifactService,
  ) {}

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
      result?.artifactCount !== 1
    ) {
      throw new Error('memory-ingest result is invalid');
    }
    const documents = await this.artifacts.readOutputJson(
      execution,
      'memory_embedding',
      'memory_embedding',
    );
    if (documents.length !== 1 || !Array.isArray(documents[0].embedding)) {
      throw new Error('memory-ingest embedding artifact is invalid');
    }
    await this.vectorStore.replaceMemory(
      memoryId,
      assistantId,
      documents[0].embedding as number[],
      {
        memory_id: memoryId,
        name: String(execution.payload['name'] ?? ''),
        type: String(execution.payload['type'] ?? 'fact'),
      },
    );
    return { success: true, memoryId };
  }
}
