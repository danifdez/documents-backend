import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { ExecutionArtifactEntity } from './execution-artifact.entity';
import { ExecutionEntity } from './execution.entity';
import { ExecutionStepEntity } from './execution-step.entity';
import { ExecutionStepStatus } from './execution-step-status.enum';
import { ExecutionArtifactStorageService } from './execution-artifact-storage.service';

@Injectable()
export class ExecutionArtifactService {
  constructor(
    @InjectRepository(ExecutionStepEntity)
    private readonly steps: Repository<ExecutionStepEntity>,
    @InjectRepository(ExecutionArtifactEntity)
    private readonly artifacts: Repository<ExecutionArtifactEntity>,
    private readonly storage: ExecutionArtifactStorageService,
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
        contentHash: true,
        size: true,
        storageRef: true,
        contentState: true,
        expiresAt: true,
        body: true,
      },
      where: {
        artifactId: In(refs.map((ref) => ref.artifactId)),
        rootExecutionId: execution.rootExecutionId,
      },
    });
    const byId = new Map(rows.map((row) => [row.artifactId, row]));
    return Promise.all(
      refs.map(async (ref) => {
        const artifact = byId.get(ref.artifactId);
        if (
          !artifact ||
          artifact.kind !== kind ||
          !artifact.producedByAttemptId
        ) {
          throw new Error(`${role} output artifact is unavailable`);
        }
        const body = await this.storage.readBody(artifact);
        if (!body) throw new Error(`${role} output artifact is unavailable`);
        try {
          const parsed = JSON.parse(body.toString('utf8'));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('not an object');
          }
          return parsed as Record<string, unknown>;
        } catch {
          throw new Error(`${role} output artifact is invalid`);
        }
      }),
    );
  }

  async findIdsForSource(
    manager: EntityManager,
    rootExecutionId: string,
    sourceId: string,
  ): Promise<string[]> {
    const rows = await manager
      .getRepository(ExecutionArtifactEntity)
      .createQueryBuilder('artifact')
      .where('artifact.root_execution_id = :rootExecutionId', {
        rootExecutionId,
      })
      .andWhere('artifact.input_source_ids @> :sourceRef::jsonb', {
        sourceRef: JSON.stringify([sourceId]),
      })
      .getMany();
    return rows.map((artifact) => artifact.artifactId);
  }

  async derivedArtifactClosure(
    manager: EntityManager,
    rootExecutionId: string,
    seedArtifactIds: string[],
  ): Promise<string[]> {
    const artifacts = await manager
      .getRepository(ExecutionArtifactEntity)
      .findBy({ rootExecutionId });
    const affected = new Set(seedArtifactIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const artifact of artifacts) {
        if (
          affected.has(artifact.artifactId) ||
          !artifact.derivedFromArtifactIds.some((id) => affected.has(id))
        ) {
          continue;
        }
        affected.add(artifact.artifactId);
        changed = true;
      }
    }
    return [...affected].sort();
  }

  async retireGraph(
    manager: EntityManager,
    rootExecutionId: string,
    seedArtifactIds: string[],
    state: 'expired' | 'withdrawn',
    reason: string,
    deletedAt: Date,
  ): Promise<string[]> {
    const closure = await this.derivedArtifactClosure(
      manager,
      rootExecutionId,
      seedArtifactIds,
    );
    if (!closure.length) return [];
    const repository = manager.getRepository(ExecutionArtifactEntity);
    const artifacts = await repository
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.root_execution_id = :rootExecutionId', {
        rootExecutionId,
      })
      .andWhere('artifact.artifact_id IN (:...artifactIds)', {
        artifactIds: closure,
      })
      .getMany();
    const active = artifacts.filter(
      (artifact) => artifact.contentState === 'active',
    );
    for (const artifact of active) {
      await this.storage.deleteBody(artifact);
      artifact.body = null;
      artifact.storageRef = `${state}:v1:${artifact.artifactId}`;
      artifact.contentState = state;
      artifact.withdrawalReason = reason;
      artifact.contentDeletedAt = deletedAt;
    }
    if (active.length) await repository.save(active);
    return active.map((artifact) => artifact.artifactId).sort();
  }
}
