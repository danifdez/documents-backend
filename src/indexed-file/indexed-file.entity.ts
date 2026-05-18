import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

export type IndexedFileOwnerType = 'main-assistant' | 'agent';

@Entity({ name: 'indexed_files' })
@Unique('UQ_indexed_files_owner_filename', ['ownerType', 'ownerId', 'filename'])
@Unique('UQ_indexed_files_file_path', ['filePath'])
export class IndexedFileEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('IDX_indexed_files_owner')
  @Column({ name: 'owner_type', length: 20 })
  ownerType: IndexedFileOwnerType;

  @Column({ name: 'owner_id' })
  ownerId: number;

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
