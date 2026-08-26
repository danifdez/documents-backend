import { Check, Column, Entity, PrimaryColumn } from 'typeorm';
import { ExecutionStepKind } from '../execution/execution-step-kind.enum';
import { WorkerKind } from './worker-kind.enum';

@Entity({ name: 'workers' })
@Check('CHK_workers_kind', `"worker_kind" IN ('models', 'browser')`)
@Check(
  'CHK_workers_kind_scope',
  `(
    "worker_kind" = 'models'
    AND "owner_principal" IS NULL
    AND NOT ('tool' = ANY("step_kinds"))
  ) OR (
    "worker_kind" = 'browser'
    AND "owner_principal" IS NOT NULL
    AND "step_kinds" = ARRAY['tool']::text[]
    AND "maximum_concurrency" = 1
  )`,
)
export class WorkerEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'worker_kind', type: 'varchar', length: 20 })
  workerKind: WorkerKind;

  @Column({
    name: 'owner_principal',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  ownerPrincipal: string | null;

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

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
