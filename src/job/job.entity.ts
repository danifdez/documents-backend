import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { JobStatus } from './job-status.enum';

@Entity({ name: 'jobs' })
export class JobEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  type: string;

  @Column({ type: 'varchar', nullable: true, default: 'normal' })
  priority: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: any;

  @Column({ type: 'varchar', default: JobStatus.PENDING })
  status: JobStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  result: any;

  @Column({ name: 'claimed_by', type: 'uuid', nullable: true })
  claimedBy: string | null;

  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'agent_iteration', type: 'integer', default: 0 })
  agentIteration: number;

  @Column({ name: 'agent_max_steps', type: 'integer', default: 1 })
  agentMaxSteps: number;

  @Column({ name: 'agent_state', type: 'jsonb', nullable: true })
  agentState: any;

  @Column({ name: 'parent_job_id', type: 'integer', nullable: true })
  parentJobId: number | null;

  @Column({ name: 'agent_kind', type: 'varchar', nullable: true })
  agentKind: string | null;

  @Column({ name: 'input_blob', type: 'bytea', nullable: true })
  inputBlob: Buffer | null;

  @Column({ name: 'result_blob', type: 'bytea', nullable: true })
  resultBlob: Buffer | null;
}
