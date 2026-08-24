import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExecutionStepKind } from './execution-step-kind.enum';
import { ExecutionStepStatus } from './execution-step-status.enum';

export interface ExecutionArtifactRef {
  role: string;
  artifactId: string;
  revision?: number;
}

@Entity({ name: 'execution_steps' })
@Index('IDX_execution_steps_execution', ['executionId'])
@Index('IDX_execution_steps_ready', ['status', 'priority', 'availableAt'])
@Index('IDX_execution_steps_current_attempt', ['currentAttemptId'])
export class ExecutionStepEntity {
  @PrimaryColumn({ name: 'step_id', type: 'uuid' })
  stepId: string;

  @Column({ name: 'execution_id', type: 'uuid' })
  executionId: string;

  @Column({ name: 'schema_version', type: 'varchar', length: 50 })
  schemaVersion: string;

  @Column({ name: 'step_kind', type: 'varchar', length: 30 })
  stepKind: ExecutionStepKind;

  @Column({ type: 'varchar', length: 30 })
  status: ExecutionStepStatus;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({
    name: 'input_artifact_refs',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  inputArtifactRefs: ExecutionArtifactRef[];

  @Column({ type: 'jsonb' })
  work: Record<string, unknown>;

  @Column({
    name: 'required_capabilities',
    type: 'text',
    array: true,
    default: () => "'{}'::text[]",
  })
  requiredCapabilities: string[];

  @Column({
    name: 'resource_keys',
    type: 'text',
    array: true,
    default: () => "'{}'::text[]",
  })
  resourceKeys: string[];

  @Column({ name: 'budget_reservation_id', type: 'uuid', nullable: true })
  budgetReservationId: string | null;

  @Column({ type: 'integer', default: 0 })
  priority: number;

  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  deadline: Date | null;

  @Column({ name: 'operation_id', type: 'uuid' })
  operationId: string;

  @Column({ name: 'current_attempt_id', type: 'uuid', nullable: true })
  currentAttemptId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  result: unknown | null;

  @Column({ type: 'jsonb', nullable: true })
  error: Record<string, unknown> | null;

  @Column({
    name: 'continuation_processed_at',
    type: 'timestamptz',
    nullable: true,
  })
  continuationProcessedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
