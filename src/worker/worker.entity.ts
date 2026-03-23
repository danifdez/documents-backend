import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity({ name: 'workers' })
export class WorkerEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'jsonb', default: [] })
  capabilities: string[];

  @Column({ default: 'online' })
  status: string;

  @Column({ name: 'last_heartbeat', type: 'timestamp', default: () => 'now()' })
  lastHeartbeat: Date;

  @Column({ name: 'started_at', type: 'timestamp', default: () => 'now()' })
  startedAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;
}
