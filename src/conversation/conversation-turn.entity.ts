import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export enum ConversationTurnStatus {
  QUEUED = 'queued',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity({ name: 'conversation_turns' })
@Index('IDX_conversation_turns_session_status', [
  'sessionId',
  'status',
  'createdAt',
])
@Index('UQ_conversation_turns_active_session', ['sessionId'], {
  unique: true,
  where: '"status" = \'active\'',
})
export class ConversationTurnEntity {
  @PrimaryColumn({ name: 'turn_id', type: 'uuid' })
  turnId: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @Column({ name: 'root_execution_id', type: 'uuid', unique: true })
  rootExecutionId: string;

  @Column({ name: 'request_artifact_id', type: 'uuid' })
  requestArtifactId: string;

  @Column({ name: 'request_artifact_revision', type: 'integer', default: 1 })
  requestArtifactRevision: number;

  @Column({ name: 'starting_conversation_revision', type: 'integer' })
  startingConversationRevision: number;

  @Column({
    name: 'terminal_conversation_revision',
    type: 'integer',
    nullable: true,
  })
  terminalConversationRevision: number | null;

  @Column({ type: 'varchar', length: 20 })
  status: ConversationTurnStatus;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
