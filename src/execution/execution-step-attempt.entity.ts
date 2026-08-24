import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExecutionStepAttemptStatus } from './execution-step-attempt-status.enum';

@Entity({ name: 'execution_step_attempts' })
@Index('IDX_execution_step_attempts_step', ['stepId', 'createdAt'])
@Index('IDX_execution_step_attempts_lease', ['status', 'leaseExpiresAt'])
@Index(
  'UQ_execution_step_attempts_identity',
  ['executionId', 'stepId', 'operationId', 'attemptId'],
  { unique: true },
)
@Index('UQ_execution_step_attempts_step_attempt', ['stepId', 'attemptId'], {
  unique: true,
})
export class ExecutionStepAttemptEntity {
  @PrimaryColumn({ name: 'attempt_id', type: 'uuid' })
  attemptId: string;

  @Column({ name: 'execution_id', type: 'uuid' })
  executionId: string;

  @Column({ name: 'step_id', type: 'uuid' })
  stepId: string;

  @Column({ name: 'operation_id', type: 'uuid' })
  operationId: string;

  @Column({ name: 'schema_version', type: 'varchar', length: 50 })
  schemaVersion: string;

  @Column({ name: 'claimed_by', type: 'uuid' })
  claimedBy: string;

  @Column({ type: 'varchar', length: 30 })
  status: ExecutionStepAttemptStatus;

  @Column({ name: 'lease_granted_at', type: 'timestamptz' })
  leaseGrantedAt: Date;

  @Column({ name: 'lease_expires_at', type: 'timestamptz' })
  leaseExpiresAt: Date;

  @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({
    name: 'finish_reason',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  finishReason: string | null;

  @Column({ name: 'result_receipt_id', type: 'uuid', nullable: true })
  resultReceiptId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
