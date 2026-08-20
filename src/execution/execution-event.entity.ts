import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'execution_events' })
@Index('UQ_execution_events_sequence', ['rootExecutionId', 'sequence'], {
  unique: true,
})
@Index(
  'UQ_execution_events_producer_sequence',
  [
    'rootExecutionId',
    'producerComponent',
    'producerInstanceId',
    'producerSequence',
  ],
  { unique: true },
)
@Index('IDX_execution_events_execution', ['rootExecutionId', 'executionId'])
@Index('IDX_execution_events_operation', ['rootExecutionId', 'operationId'])
@Index('IDX_execution_events_type', ['rootExecutionId', 'eventType'])
export class ExecutionEventEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'root_execution_id', type: 'uuid' })
  rootExecutionId: string;

  @Column({ type: 'bigint' })
  sequence: string;

  @Column({ name: 'producer_component', type: 'varchar', length: 80 })
  producerComponent: string;

  @Column({ name: 'producer_instance_id', type: 'varchar', length: 200 })
  producerInstanceId: string;

  @Column({ name: 'producer_sequence', type: 'bigint' })
  producerSequence: string;

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType: string;

  @Column({ name: 'execution_id', type: 'uuid' })
  executionId: string;

  @Column({ name: 'operation_id', type: 'uuid', nullable: true })
  operationId: string | null;

  @Column({ name: 'attempt_id', type: 'uuid', nullable: true })
  attemptId: string | null;

  @Column({ name: 'caused_by_event_id', type: 'uuid', nullable: true })
  causedByEventId: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @CreateDateColumn({ name: 'ingested_at', type: 'timestamptz' })
  ingestedAt: Date;

  @Column({ name: 'content_hash', type: 'varchar', length: 71 })
  contentHash: string;

  @Column({ type: 'jsonb' })
  envelope: Record<string, unknown>;
}
