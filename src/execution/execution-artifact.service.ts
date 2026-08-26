import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ExecutionArtifactEntity } from './execution-artifact.entity';
import { ExecutionEntity } from './execution.entity';
import { ExecutionStepEntity } from './execution-step.entity';
import { ExecutionStepStatus } from './execution-step-status.enum';

@Injectable()
export class ExecutionArtifactService {
  constructor(
    @InjectRepository(ExecutionStepEntity)
    private readonly steps: Repository<ExecutionStepEntity>,
    @InjectRepository(ExecutionArtifactEntity)
    private readonly artifacts: Repository<ExecutionArtifactEntity>,
  ) {}

  async readOutputJson(
    execution: ExecutionEntity,
    role: string,
    kind: string,
  ): Promise<Record<string, unknown>[]> {
    const steps = await this.steps.find({
      where: {
        executionId: execution.executionId,
        status: ExecutionStepStatus.COMPLETED,
      },
      order: { createdAt: 'ASC' },
    });
    const refs = steps
      .flatMap((step) => step.outputArtifactRefs ?? [])
      .filter((ref) => ref.role === role)
      .sort(
        (left, right) =>
          (left.revision ?? 0) - (right.revision ?? 0) ||
          left.artifactId.localeCompare(right.artifactId),
      );
    if (!refs.length) return [];
    refs.forEach((ref, index) => {
      if (ref.revision !== index + 1) {
        throw new Error(`${role} artifact revisions are not contiguous`);
      }
    });
    const rows = await this.artifacts.find({
      select: {
        artifactId: true,
        rootExecutionId: true,
        kind: true,
        producedByAttemptId: true,
        body: true,
      },
      where: {
        artifactId: In(refs.map((ref) => ref.artifactId)),
        rootExecutionId: execution.rootExecutionId,
      },
    });
    const byId = new Map(rows.map((row) => [row.artifactId, row]));
    return refs.map((ref) => {
      const artifact = byId.get(ref.artifactId);
      if (
        !artifact?.body ||
        artifact.kind !== kind ||
        !artifact.producedByAttemptId
      ) {
        throw new Error(`${role} output artifact is unavailable`);
      }
      try {
        const parsed = JSON.parse(artifact.body.toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        return parsed as Record<string, unknown>;
      } catch {
        throw new Error(`${role} output artifact is invalid`);
      }
    });
  }
}
