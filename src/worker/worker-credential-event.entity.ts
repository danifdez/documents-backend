import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WorkerKind } from './worker-kind.enum';

export type WorkerCredentialAction = 'issued' | 'rotated' | 'revoked';
export type WorkerCredentialActorType = 'service' | 'user';

@Entity({ name: 'worker_credential_events' })
@Index('IDX_worker_credential_events_worker_occurred', [
  'workerId',
  'occurredAt',
])
@Check(
  'CHK_worker_credential_events_action',
  `"action" IN ('issued', 'rotated', 'revoked')`,
)
@Check(
  'CHK_worker_credential_events_actor_type',
  `"actor_type" IN ('service', 'user')`,
)
export class WorkerCredentialEventEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'event_id' })
  eventId: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  workerId: string;

  @Column({ name: 'worker_kind', type: 'varchar', length: 20 })
  workerKind: WorkerKind;

  @Column({ type: 'varchar', length: 20 })
  action: WorkerCredentialAction;

  @Column({ name: 'actor_type', type: 'varchar', length: 20 })
  actorType: WorkerCredentialActorType;

  @Column({
    name: 'actor_principal',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  actorPrincipal: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;
}
