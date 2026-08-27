import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { canonicalHash } from './execution-canonical';
import { ExecutionEntity } from './execution.entity';
import {
  ExecutionEffectJournalEntity,
  type ExecutionEffectJournalStatus,
} from './execution-effect-journal.entity';

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

export interface DurableExternalEffectState {
  status: ExecutionEffectJournalStatus;
  intent: Record<string, unknown>;
  preparationObservation: Record<string, unknown>;
  observation: Record<string, unknown> | null;
  lastObservation: Record<string, unknown> | null;
  lastObservedAt: Date | null;
}

@Injectable()
export class ExecutionEffectJournalService {
  constructor(private readonly dataSource: DataSource) {}

  async getVerifiedObservation(
    executionId: string,
    effectKey: string,
    effectType: string,
    resourceKey: string,
  ): Promise<Record<string, unknown> | null> {
    const existing = await this.dataSource
      .getRepository(ExecutionEffectJournalEntity)
      .findOneBy({ executionId, effectKey });
    if (!existing) return null;
    if (
      existing.effectType !== effectType ||
      existing.resourceKey !== resourceKey ||
      existing.status !== 'verified' ||
      !existing.observation
    ) {
      throw new Error('execution_effect_journal_conflict');
    }
    return existing.observation;
  }

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
        intent: input.intent,
        preparationObservation: null,
        status: 'prepared',
        observation: null,
        lastObservation: null,
        lastObservedAt: null,
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

  async prepareExternal(
    input: VerifiedExecutionEffectInput,
    preparationObservation: Record<string, unknown>,
  ): Promise<DurableExternalEffectState> {
    this.assertObservation(preparationObservation);
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
        this.assertIdentity(existing, input, intentHash);
        if (!existing.preparationObservation) {
          throw new Error('execution_effect_journal_conflict');
        }
        return this.externalState(existing);
      }

      const journal = repository.create({
        executionId: input.executionId,
        effectKey: input.effectKey,
        effectType: input.effectType,
        resourceKey: input.resourceKey,
        intentHash,
        intent: input.intent,
        preparationObservation,
        status: 'prepared',
        observation: null,
        lastObservation: null,
        lastObservedAt: null,
        appliedAt: null,
        verifiedAt: null,
      });
      await repository.save(journal);
      return this.externalState(journal);
    });
  }

  async recordExternalObservation(
    input: VerifiedExecutionEffectInput,
    observation: Record<string, unknown>,
    disposition: 'continue' | 'verified' | 'inconclusive',
  ): Promise<DurableExternalEffectState> {
    this.assertObservation(observation);
    const intentHash = canonicalHash(input.intent);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ExecutionEffectJournalEntity);
      const journal = await repository.findOne({
        where: {
          executionId: input.executionId,
          effectKey: input.effectKey,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!journal) throw new Error('execution_effect_journal_missing');
      this.assertIdentity(journal, input, intentHash);
      if (!journal.preparationObservation) {
        throw new Error('execution_effect_journal_conflict');
      }
      if (journal.status !== 'prepared') {
        if (
          disposition === journal.status &&
          journal.observation &&
          canonicalHash(journal.observation) === canonicalHash(observation)
        ) {
          return this.externalState(journal);
        }
        throw new Error('execution_effect_journal_conflict');
      }

      const observedAt = new Date();
      journal.lastObservation = observation;
      journal.lastObservedAt = observedAt;
      if (disposition !== 'continue') {
        journal.status = disposition;
        journal.observation = observation;
        journal.verifiedAt = observedAt;
        journal.appliedAt =
          observation.effectStatus === 'applied' ? observedAt : null;
      }
      await repository.save(journal);
      return this.externalState(journal);
    });
  }

  async readExternal(
    input: VerifiedExecutionEffectInput,
  ): Promise<DurableExternalEffectState | null> {
    const journal = await this.dataSource
      .getRepository(ExecutionEffectJournalEntity)
      .findOneBy({
        executionId: input.executionId,
        effectKey: input.effectKey,
      });
    if (!journal) return null;
    this.assertIdentity(journal, input, canonicalHash(input.intent));
    if (!journal.preparationObservation) {
      throw new Error('execution_effect_journal_conflict');
    }
    return this.externalState(journal);
  }

  private assertIdentity(
    journal: ExecutionEffectJournalEntity,
    input: VerifiedExecutionEffectInput,
    intentHash: string,
  ): void {
    if (
      journal.effectType !== input.effectType ||
      journal.resourceKey !== input.resourceKey ||
      journal.intentHash !== intentHash ||
      canonicalHash(journal.intent) !== intentHash
    ) {
      throw new Error('execution_effect_journal_conflict');
    }
  }

  private assertObservation(observation: Record<string, unknown>): void {
    if (
      !observation ||
      typeof observation !== 'object' ||
      Array.isArray(observation)
    ) {
      throw new Error('execution_effect_observation_invalid');
    }
  }

  private externalState(
    journal: ExecutionEffectJournalEntity,
  ): DurableExternalEffectState {
    return {
      status: journal.status,
      intent: journal.intent,
      preparationObservation: journal.preparationObservation!,
      observation: journal.observation,
      lastObservation: journal.lastObservation,
      lastObservedAt: journal.lastObservedAt,
    };
  }
}
