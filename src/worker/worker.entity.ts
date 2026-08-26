import { Entity, PrimaryColumn, Column } from 'typeorm';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';

@Entity({ name: 'workers' })
export class WorkerEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'jsonb', default: [] })
  capabilities: string[];

  @Column({ name: 'protocol_version', length: 50, default: 'step-protocol/1' })
  protocolVersion: 'step-protocol/1';

  @Column({
    name: 'step_kinds',
    type: 'text',
    array: true,
    default: () => "'{}'::text[]",
  })
  stepKinds: ExecutionStepKind[];

  @Column({ name: 'maximum_concurrency', type: 'integer', default: 1 })
  maximumConcurrency: number;

  @Column({ default: 'online' })
  status: string;

  @Column({ name: 'last_heartbeat', type: 'timestamp', default: () => 'now()' })
  lastHeartbeat: Date;

  @Column({ name: 'started_at', type: 'timestamp', default: () => 'now()' })
  startedAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @Column({
    name: 'credential_hash',
    type: 'varchar',
    length: 71,
    nullable: true,
    select: false,
  })
  credentialHash: string | null;
}
