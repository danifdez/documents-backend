import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExecutionStatus } from './execution-status.enum';
import type {
  ProgressLedger,
  ProgressPolicyProjection,
} from './execution-progress';

@Entity({ name: 'executions' })
@Index('IDX_executions_owner', ['ownerPrincipal'])
@Index('IDX_executions_root', ['rootExecutionId'])
@Index('IDX_executions_parent', ['parentExecutionId'])
export class ExecutionEntity {
  @PrimaryColumn({ name: 'execution_id', type: 'uuid' })
  executionId: string;

  @Column({ name: 'root_execution_id', type: 'uuid' })
  rootExecutionId: string;

  @Column({ name: 'parent_execution_id', type: 'uuid', nullable: true })
  parentExecutionId: string | null;

  @Column({ name: 'turn_id', type: 'uuid', nullable: true })
  turnId: string | null;

  @Column({ name: 'owner_principal', type: 'varchar', length: 200 })
  ownerPrincipal: string;

  @Column({ name: 'schema_version', type: 'varchar', length: 50 })
  schemaVersion: string;

  @Column({ name: 'task_type', type: 'varchar', length: 100 })
  taskType: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: any;

  @Column({ type: 'varchar', length: 20, default: ExecutionStatus.QUEUED })
  status: ExecutionStatus;

  @Column({ type: 'varchar', length: 80, nullable: true })
  phase: string | null;

  @Column({ name: 'wait_reason', type: 'varchar', length: 40, nullable: true })
  waitReason: string | null;

  @Column({ name: 'wait_condition', type: 'jsonb', nullable: true })
  waitCondition: Record<string, unknown> | null;

  @Column({ name: 'resume_phase', type: 'varchar', length: 80, nullable: true })
  resumePhase: string | null;

  @Column({ name: 'wait_expires_at', type: 'timestamptz', nullable: true })
  waitExpiresAt: Date | null;

  @Column({
    name: 'cancellation_requested_at',
    type: 'timestamptz',
    nullable: true,
  })
  cancellationRequestedAt: Date | null;

  @Column({
    name: 'cancellation_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  cancellationReason: string | null;

  @Column({
    name: 'completion_kind',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  completionKind: string | null;

  @Column({
    name: 'completion_reason',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  completionReason: string | null;

  @Column({ type: 'jsonb', nullable: true })
  result: any;

  @Column({ type: 'jsonb', nullable: true })
  error: any;

  @Column({ name: 'progress_policy', type: 'jsonb', nullable: true })
  progressPolicy: ProgressPolicyProjection | null;

  @Column({ name: 'progress_ledger', type: 'jsonb', nullable: true })
  progressLedger: ProgressLedger | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'last_sequence', type: 'bigint', default: 0 })
  lastSequence: string;

  @Column({ name: 'last_event_id', type: 'uuid', nullable: true })
  lastEventId: string | null;

  @Column({
    name: 'completeness_status',
    type: 'varchar',
    length: 30,
    default: 'reproducible',
  })
  completenessStatus: string;

  @Column({
    name: 'missing_evidence',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  missingEvidence: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
