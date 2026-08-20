import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExecutionStatus } from './execution-status.enum';

@Entity({ name: 'executions' })
@Index('IDX_executions_access', ['ownerPrincipal', 'workspaceId'])
@Index('IDX_executions_root', ['rootExecutionId'])
@Index('IDX_executions_parent', ['parentExecutionId'])
@Index('IDX_executions_queue', ['status', 'priority', 'availableAt'])
@Index('IDX_executions_claimed_by', ['claimedBy'])
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

  @Column({ name: 'workspace_id', type: 'varchar', length: 200 })
  workspaceId: string;

  @Column({ name: 'schema_version', type: 'varchar', length: 50 })
  schemaVersion: string;

  @Column({ name: 'task_type', type: 'varchar', length: 100 })
  taskType: string;

  @Column({ type: 'varchar', length: 30, default: 'root' })
  origin: string;

  @Column({ type: 'varchar', length: 20, default: 'normal' })
  priority: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: any;

  @Column({ type: 'varchar', length: 20, default: ExecutionStatus.QUEUED })
  status: ExecutionStatus;

  @Column({ type: 'varchar', length: 80, nullable: true })
  phase: string | null;

  @Column({ name: 'wait_reason', type: 'varchar', length: 100, nullable: true })
  waitReason: string | null;

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

  @Column({ type: 'jsonb', nullable: true })
  checkpoint: any;

  @Column({ type: 'integer', default: 0 })
  step: number;

  @Column({ name: 'max_steps', type: 'integer', default: 1 })
  maxSteps: number;

  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt: Date;

  @Column({ name: 'claimed_by', type: 'uuid', nullable: true })
  claimedBy: string | null;

  @Column({ name: 'attempt_id', type: 'uuid', nullable: true })
  attemptId: string | null;

  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 3 })
  maxAttempts: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'input_blob', type: 'bytea', nullable: true, select: false })
  inputBlob: Buffer | null;

  @Column({ name: 'result_blob', type: 'bytea', nullable: true, select: false })
  resultBlob: Buffer | null;

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
