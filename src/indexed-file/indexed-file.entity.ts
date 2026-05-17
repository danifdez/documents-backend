import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { AssistantEntity } from '../assistant/assistant.entity';

@Entity({ name: 'indexed_files' })
@Unique('UQ_indexed_files_assistant_filename', ['assistantId', 'filename'])
@Unique('UQ_indexed_files_file_path', ['filePath'])
export class IndexedFileEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('IDX_indexed_files_assistant_id')
  @Column({ name: 'assistant_id' })
  assistantId: number;

  @ManyToOne(() => AssistantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assistant_id' })
  assistant: AssistantEntity;

  @Column({ length: 500 })
  filename: string;

  @Column({ name: 'file_path', length: 1000 })
  filePath: string;

  @Column({ name: 'mime_type', length: 200 })
  mimeType: string;

  @Column({ type: 'bigint' })
  size: number;

  @Column({ name: 'mtime', type: 'timestamp' })
  mtime: Date;

  @Column({ length: 128 })
  checksum: string;

  @Column({ name: 'extracted_text', type: 'text', nullable: true })
  extractedText: string | null;

  @Column({ name: 'embedding_id', length: 200, nullable: true })
  embeddingId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
