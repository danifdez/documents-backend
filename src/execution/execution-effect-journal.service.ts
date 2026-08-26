import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { canonicalHash } from './execution-canonical';
import { ExecutionEffectJournalEntity } from './execution-effect-journal.entity';
import { ExecutionEntity } from './execution.entity';

export interface VerifiedExecutionEffectInput {
  executionId: string;
  effectKey: string;
  effectType: string;
  resourceKey: string;
  intent: Record<string, unknown>;
}

export interface VerifiedExecutionEffectResult {
  applied: boolean;
  observation: Record<string, unknown>;
}

@Injectable()
export class ExecutionEffectJournalService {
  constructor(private readonly dataSource: DataSource) {}

  runVerified(
    input: VerifiedExecutionEffectInput,
    applyAndVerify: (
      manager: EntityManager,
    ) => Promise<Record<string, unknown>>,
  ): Promise<VerifiedExecutionEffectResult> {
    const intentHash = canonicalHash(input.intent);
    return this.dataSource.transaction(async (manager) => {
      const execution = await manager.getRepository(ExecutionEntity).findOne({
        where: { executionId: input.executionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!execution) throw new Error('execution_effect_owner_not_found');

      const repository = manager.getRepository(ExecutionEffectJournalEntity);
      const existing = await repository.findOne({
        where: {
          executionId: input.executionId,
          effectKey: input.effectKey,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing) {
        if (
          existing.effectType !== input.effectType ||
          existing.resourceKey !== input.resourceKey ||
          existing.intentHash !== intentHash ||
          existing.status !== 'verified' ||
          !existing.observation
        ) {
          throw new Error('execution_effect_journal_conflict');
        }
        return { applied: false, observation: existing.observation };
      }

      const journal = repository.create({
        executionId: input.executionId,
        effectKey: input.effectKey,
        effectType: input.effectType,
        resourceKey: input.resourceKey,
        intentHash,
        status: 'prepared',
        observation: null,
        appliedAt: null,
        verifiedAt: null,
      });
      await repository.save(journal);

      const observation = await applyAndVerify(manager);
      if (
        !observation ||
        typeof observation !== 'object' ||
        Array.isArray(observation)
      ) {
        throw new Error('execution_effect_observation_invalid');
      }
      const verifiedAt = new Date();
      journal.status = 'verified';
      journal.observation = observation;
      journal.appliedAt = verifiedAt;
      journal.verifiedAt = verifiedAt;
      await repository.save(journal);
      return { applied: true, observation };
    });
  }
}
