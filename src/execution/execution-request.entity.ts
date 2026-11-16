import { Column, Entity, PrimaryColumn } from 'typeorm';

// Acceptance/cancellation identity only. Work and results remain in executions.
@Entity({ name: 'execution_requests' })
export class ExecutionRequestEntity {
  @PrimaryColumn({ name: 'owner_principal', type: 'varchar', length: 200 })
  ownerPrincipal: string;

  @PrimaryColumn({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @Column({ name: 'input_hash', type: 'varchar', length: 71, nullable: true })
  inputHash: string | null;

  @Column({ name: 'execution_id', type: 'uuid', nullable: true, unique: true })
  executionId: string | null;

  @Column({ name: 'cancel_requested', type: 'boolean', default: false })
  cancelRequested: boolean;
}
