import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AgentEntity } from './agent.entity';

@Entity({ name: 'agent_messages' })
@Index('IDX_agent_messages_agent_id_created_at', ['agentId', 'createdAt'])
export class AgentMessageEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('IDX_agent_messages_agent_id')
  @Column({ name: 'agent_id' })
  agentId: number;

  @ManyToOne(() => AgentEntity, (a) => a.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: AgentEntity;

  @Column({ length: 16 })
  role: 'user' | 'assistant' | 'system' | 'event';

  @Column({ type: 'text' })
  content: string;

  @Index('IDX_agent_messages_job_id')
  @Column({ name: 'job_id', type: 'integer', nullable: true })
  jobId: number | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'jsonb', nullable: true })
  event: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
