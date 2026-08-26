import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { ExecutionStatus } from '../execution/execution-status.enum';
import type { ActiveCapabilitySet } from './active-capabilities';
import {
  SkillActivationEntity,
  SkillActivationStatus,
} from './skill-activation.entity';

export const SKILL_ACTIVATION_SCHEMA = 'skill-activation/1';

export async function createSkillActivations(
  manager: EntityManager,
  executionId: string,
  capabilities: ActiveCapabilitySet,
): Promise<SkillActivationEntity[]> {
  if (!capabilities.skills.length) return [];
  const repo = manager.getRepository(SkillActivationEntity);
  const existing = await repo.find({ where: { executionId } });
  if (existing.length) {
    const expected = capabilities.skills.map(skillIdentity).sort();
    const observed = existing
      .map((activation) =>
        skillIdentity({
          skillId: activation.skillId,
          version: activation.skillVersion,
          contentHash: activation.contentHash,
        }),
      )
      .sort();
    if (JSON.stringify(expected) !== JSON.stringify(observed)) {
      throw new ConflictException('skill_activation_conflict');
    }
    return existing;
  }

  return repo.save(
    capabilities.skills.map((skill) =>
      repo.create({
        activationId: randomUUID(),
        executionId,
        schemaVersion: SKILL_ACTIVATION_SCHEMA,
        skillId: skill.skillId,
        skillVersion: skill.version,
        contentHash: skill.contentHash,
        activationReason: skill.activationReason,
        inputBindings: { owner: capabilities.owner },
        phase: 'instructions_loaded',
        checkpoint: null,
        status: 'active',
        finishedAt: null,
      }),
    ),
  );
}

export async function finishSkillActivations(
  manager: EntityManager,
  executionId: string,
  executionStatus: ExecutionStatus,
): Promise<void> {
  const status = terminalSkillStatus(executionStatus);
  if (!status) return;
  await manager
    .getRepository(SkillActivationEntity)
    .createQueryBuilder()
    .update()
    .set({ status, phase: 'finished', finishedAt: new Date() })
    .where('execution_id = :executionId', { executionId })
    .andWhere("status = 'active'")
    .execute();
}

export async function advanceSkillActivation(
  manager: EntityManager,
  activationId: string,
  expectedPhase: string,
  nextPhase: string,
  checkpoint: Record<string, unknown>,
): Promise<SkillActivationEntity> {
  const repo = manager.getRepository(SkillActivationEntity);
  const activation = await repo.findOne({
    where: { activationId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!activation) throw new ConflictException('skill_activation_not_found');
  if (activation.status !== 'active') {
    throw new ConflictException('skill_activation_not_active');
  }
  if (activation.phase !== expectedPhase) {
    throw new ConflictException('skill_activation_phase_stale');
  }
  if (!nextPhase.trim() || nextPhase.length > 80) {
    throw new ConflictException('skill_activation_phase_invalid');
  }
  activation.phase = nextPhase;
  activation.checkpoint = checkpoint;
  return repo.save(activation);
}

function terminalSkillStatus(
  status: ExecutionStatus,
): SkillActivationStatus | null {
  if (status === ExecutionStatus.COMPLETED) return 'completed';
  if (status === ExecutionStatus.FAILED) return 'failed';
  if (status === ExecutionStatus.CANCELLED) return 'cancelled';
  return null;
}

function skillIdentity(skill: {
  skillId: string;
  version: string;
  contentHash: string;
}): string {
  return `${skill.skillId}\0${skill.version}\0${skill.contentHash}`;
}
