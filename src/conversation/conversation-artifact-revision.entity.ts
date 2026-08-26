import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export interface ConversationArtifactMessage {
  messageId: number;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;
  executionId: string | null;
  error: string | null;
  createdAt: string;
}

@Entity({ name: 'conversation_artifact_revisions' })
@Index(
  'UQ_conversation_artifact_revisions_session_revision',
  ['sessionId', 'revision'],
  { unique: true },
)
export class ConversationArtifactRevisionEntity {
  @PrimaryColumn({ name: 'artifact_id', type: 'uuid' })
  artifactId: string;

  @PrimaryColumn({ type: 'integer' })
  revision: number;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @Column({ name: 'parent_revision', type: 'integer', nullable: true })
  parentRevision: number | null;

  @Column({ name: 'content_hash', type: 'varchar', length: 71 })
  contentHash: string;

  @Column({ type: 'jsonb' })
  messages: ConversationArtifactMessage[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
