import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SkillActivationStatus =
  'active' | 'completed' | 'failed' | 'cancelled' | 'superseded';

@Entity({ name: 'execution_skill_activations' })
@Index('UQ_execution_skill_activations_identity', ['executionId', 'skillId'], {
  unique: true,
})
@Index('IDX_execution_skill_activations_execution', ['executionId', 'status'])
export class SkillActivationEntity {
  @PrimaryColumn({ name: 'activation_id', type: 'uuid' })
  activationId: string;

  @Column({ name: 'execution_id', type: 'uuid' })
  executionId: string;

  @Column({ name: 'schema_version', type: 'varchar', length: 50 })
  schemaVersion: string;

  @Column({ name: 'skill_id', type: 'varchar', length: 100 })
  skillId: string;

  @Column({ name: 'skill_version', type: 'varchar', length: 100 })
  skillVersion: string;

  @Column({ name: 'content_hash', type: 'varchar', length: 71 })
  contentHash: string;

  @Column({ name: 'activation_reason', type: 'varchar', length: 50 })
  activationReason: string;

  @Column({ name: 'input_bindings', type: 'jsonb' })
  inputBindings: Record<string, unknown>;

  @Column({ type: 'varchar', length: 80 })
  phase: string;

  @Column({ type: 'jsonb', nullable: true })
  checkpoint: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 20 })
  status: SkillActivationStatus;

  @CreateDateColumn({ name: 'activated_at', type: 'timestamptz' })
  activatedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
