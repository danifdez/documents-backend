import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExecutionOperationRecoveryClass } from './execution-operation-recovery-class.enum';
import { ExecutionOperationKind } from './execution-operation-kind.enum';
import { ExecutionOperationStatus } from './execution-operation-status.enum';

@Entity({ name: 'execution_operations' })
@Index('IDX_execution_operations_execution', ['executionId'])
@Index('UQ_execution_operations_step', ['stepId'], { unique: true })
@Index('IDX_execution_operations_status', ['status', 'updatedAt'])
export class ExecutionOperationEntity {
  @PrimaryColumn({ name: 'operation_id', type: 'uuid' })
  operationId: string;

  @Column({ name: 'execution_id', type: 'uuid' })
  executionId: string;

  @Column({ name: 'step_id', type: 'uuid' })
  stepId: string;

  @Column({ name: 'schema_version', type: 'varchar', length: 50 })
  schemaVersion: string;

  @Column({ name: 'operation_kind', type: 'varchar', length: 30 })
  operationKind: ExecutionOperationKind;

  @Column({ type: 'varchar', length: 30 })
  status: ExecutionOperationStatus;

  @Column({ name: 'recovery_class', type: 'varchar', length: 30 })
  recoveryClass: ExecutionOperationRecoveryClass;

  @Column({ name: 'current_attempt_id', type: 'uuid', nullable: true })
  currentAttemptId: string | null;

  @Column({ name: 'caused_by_event_id', type: 'uuid' })
  causedByEventId: string;

  @Column({ type: 'jsonb', nullable: true })
  result: unknown | null;

  @Column({ type: 'jsonb', nullable: true })
  error: Record<string, unknown> | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
