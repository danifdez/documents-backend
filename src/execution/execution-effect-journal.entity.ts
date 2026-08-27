import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ExecutionEffectJournalStatus =
  'prepared' | 'verified' | 'inconclusive';

@Entity({ name: 'execution_effect_journal' })
@Index('UQ_execution_effect_journal_identity', ['executionId', 'effectKey'], {
  unique: true,
})
@Index('IDX_execution_effect_journal_execution', ['executionId', 'status'])
export class ExecutionEffectJournalEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'journal_id' })
  journalId: string;

  @Column({ name: 'execution_id', type: 'uuid' })
  executionId: string;

  @Column({ name: 'effect_key', type: 'varchar', length: 160 })
  effectKey: string;

  @Column({ name: 'effect_type', type: 'varchar', length: 80 })
  effectType: string;

  @Column({ name: 'resource_key', type: 'varchar', length: 255 })
  resourceKey: string;

  @Column({ name: 'intent_hash', type: 'varchar', length: 71 })
  intentHash: string;

  @Column({ type: 'jsonb' })
  intent: Record<string, unknown>;

  @Column({ name: 'preparation_observation', type: 'jsonb', nullable: true })
  preparationObservation: Record<string, unknown> | null;

  @Column({ name: 'last_observation', type: 'jsonb', nullable: true })
  lastObservation: Record<string, unknown> | null;

  @Column({ name: 'last_observed_at', type: 'timestamptz', nullable: true })
  lastObservedAt: Date | null;

  @Column({ type: 'varchar', length: 20 })
  status: ExecutionEffectJournalStatus;

  @Column({ type: 'jsonb', nullable: true })
  observation: Record<string, unknown> | null;

  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt: Date | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
