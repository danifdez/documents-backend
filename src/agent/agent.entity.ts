import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { AgentMessageEntity } from './agent-message.entity';

@Entity({ name: 'agents' })
@Index('IDX_agents_pinned_last_seen_at', ['pinned', 'lastSeenAt'])
@Index('IDX_agents_expires_at', ['expiresAt'])
export class AgentEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ name: 'system_prompt', type: 'text', nullable: true })
  systemPrompt: string | null;

  @Column({ name: 'folder_scope', length: 500, nullable: true })
  folderScope: string | null;

  @Column({ length: 16, nullable: true })
  icon: string | null;

  @Column({ length: 300, nullable: true })
  sub: string | null;

  @Column({ default: false })
  pinned: boolean;

  @Column({ name: 'last_seen_at', type: 'timestamp', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @OneToMany(() => AgentMessageEntity, (msg) => msg.agent)
  messages: AgentMessageEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
