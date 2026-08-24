import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'execution_result_receipts' })
@Index('UQ_execution_result_receipts_attempt', ['attemptId'], { unique: true })
@Index('IDX_execution_result_receipts_step', ['stepId', 'receivedAt'])
export class ExecutionResultReceiptEntity {
  @PrimaryColumn({ name: 'receipt_id', type: 'uuid' })
  receiptId: string;

  @Column({ name: 'execution_id', type: 'uuid' })
  executionId: string;

  @Column({ name: 'step_id', type: 'uuid' })
  stepId: string;

  @Column({ name: 'operation_id', type: 'uuid' })
  operationId: string;

  @Column({ name: 'attempt_id', type: 'uuid' })
  attemptId: string;

  @Column({ name: 'schema_version', type: 'varchar', length: 50 })
  schemaVersion: string;

  @Column({ name: 'result_hash', type: 'varchar', length: 71 })
  resultHash: string;

  @Column({ type: 'jsonb' })
  result: Record<string, unknown>;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;
}
