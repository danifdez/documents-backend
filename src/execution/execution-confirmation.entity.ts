import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExecutionConfirmationStatus } from './execution-confirmation.types';

@Entity({ name: 'execution_confirmations' })
@Index('UQ_execution_confirmations_operation', ['operationId'], {
  unique: true,
})
@Index('IDX_execution_confirmations_owner_status', [
  'ownerPrincipal',
  'status',
  'createdAt',
])
export class ExecutionConfirmationEntity {
  @PrimaryColumn({ name: 'confirmation_id', type: 'uuid' })
  confirmationId: string;

  @Column({ name: 'execution_id', type: 'uuid' })
  executionId: string;

  @Column({ name: 'operation_id', type: 'uuid' })
  operationId: string;

  @Column({ name: 'owner_principal', type: 'varchar', length: 200 })
  ownerPrincipal: string;

  @Column({ name: 'plan_hash', type: 'varchar', length: 71 })
  planHash: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: ExecutionConfirmationStatus;

  @Column({ name: 'decided_by', type: 'varchar', length: 200, nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'requested_at', type: 'timestamptz', nullable: true })
  requestedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
