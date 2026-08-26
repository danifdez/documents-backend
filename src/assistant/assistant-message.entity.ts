import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AssistantEntity } from './assistant.entity';

@Entity({ name: 'assistant_messages' })
@Index(
  'UQ_assistant_messages_execution_reply',
  ['assistantId', 'executionId'],
  {
    unique: true,
    where: '"execution_id" IS NOT NULL AND "role" = \'assistant\'',
  },
)
@Index('UQ_assistant_messages_turn_role', ['turnId', 'role'], {
  unique: true,
  where: "\"role\" IN ('user', 'assistant')",
})
export class AssistantMessageEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'assistant_id' })
  assistantId: number;

  @ManyToOne(() => AssistantEntity, (a) => a.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assistant_id' })
  assistant: AssistantEntity;

  @Column({ length: 16 })
  role: 'user' | 'assistant' | 'system' | 'event';

  @Column({ type: 'text' })
  content: string;

  @Index()
  @Column({ name: 'turn_id', type: 'uuid', nullable: true })
  turnId: string | null;

  @Index()
  @Column({ name: 'execution_id', type: 'uuid', nullable: true })
  executionId: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /**
   * Structured event payload for inline cards. Non-null only for event rows.
   */
  @Column({ type: 'jsonb', nullable: true })
  event: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
