import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { AssistantMessageEntity } from './assistant-message.entity';

@Entity({ name: 'assistants' })
export class AssistantEntity {
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

  @Column({ name: 'is_system', default: false })
  isSystem: boolean;

  @Column({ default: false })
  pinned: boolean;

  @Column({ length: 300, nullable: true })
  sub: string | null;

  @Column({ name: 'last_seen_at', type: 'timestamp', nullable: true })
  lastSeenAt: Date | null;

  @OneToMany(() => AssistantMessageEntity, (msg) => msg.assistant)
  messages: AssistantMessageEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
