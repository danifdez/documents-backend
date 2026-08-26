import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ConversationOwnerType = 'assistant' | 'agent';

@Entity({ name: 'conversation_sessions' })
@Index('UQ_conversation_sessions_owner', ['ownerType', 'ownerId'], {
  unique: true,
})
export class ConversationSessionEntity {
  @PrimaryColumn({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @Column({ name: 'owner_type', type: 'varchar', length: 20 })
  ownerType: ConversationOwnerType;

  @Column({ name: 'owner_id', type: 'integer' })
  ownerId: number;

  @Column({ name: 'conversation_artifact_id', type: 'uuid' })
  conversationArtifactId: string;

  @Column({ name: 'conversation_revision', type: 'integer', default: 0 })
  conversationRevision: number;

  @Column({ name: 'active_turn_id', type: 'uuid', nullable: true })
  activeTurnId: string | null;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
