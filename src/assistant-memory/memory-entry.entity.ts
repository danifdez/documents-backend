import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { AssistantEntity } from '../assistant/assistant.entity';

export type MemoryEntryType = 'fact' | 'event' | 'instruction';
export type MemoryEntrySource = 'manual' | 'detected' | 'imported';

@Entity({ name: 'assistant_memory_entries' })
export class MemoryEntryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'assistant_id' })
  assistantId: number;

  @ManyToOne(() => AssistantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assistant_id' })
  assistant: AssistantEntity;

  @Column({ length: 120 })
  name: string;

  @Column({ length: 16 })
  type: MemoryEntryType;

  @Column({ type: 'text' })
  body: string;

  @Column({ length: 16, default: 'manual' })
  source: MemoryEntrySource;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
