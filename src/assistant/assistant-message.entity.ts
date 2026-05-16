import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { AssistantEntity } from './assistant.entity';

@Entity({ name: 'assistant_messages' })
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
  @Column({ name: 'job_id', type: 'integer', nullable: true })
  jobId: number | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /**
   * Structured event payload for inline cards (e.g. {kind: 'memory_saved',
   * entry: {...}}). Non-null only when role === 'event'.
   */
  @Column({ type: 'jsonb', nullable: true })
  event: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
