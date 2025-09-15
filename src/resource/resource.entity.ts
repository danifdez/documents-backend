import { ProjectEntity } from '../project/project.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
} from 'typeorm';

@Entity({ name: 'resources' })
export class ResourceEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ProjectEntity, (project) => project.resources, {
    nullable: true,
  })
  project: ProjectEntity | null;

  @Column()
  name: string;

  @Column({ nullable: true })
  hash: string | null;

  @Column({ name: 'related_to', nullable: true })
  relatedTo: string | null;

  @Column({ nullable: true })
  type: string | null;

  @Column({ name: 'mime_type', nullable: true })
  mimeType: string | null;

  @Column({ name: 'original_name', nullable: true })
  originalName: string | null;

  @Column({ name: 'upload_date', nullable: true })
  uploadDate: string | null;

  @Column({ name: 'file_size', type: 'int', nullable: true })
  fileSize: number | null;

  @Column({ nullable: true })
  path: string | null;

  @Column({ nullable: true })
  url: string | null;

  @Column({ nullable: true })
  title: string | null;

  @Column({ name: 'publication_date', nullable: true })
  publicationDate: string | null;

  @Column({ nullable: true })
  author: string | null;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'text', name: 'translated_content', nullable: true })
  translatedContent: string | null;

  @Column({ type: 'text', name: 'working_content', nullable: true })
  workingContent: string | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ nullable: true })
  language: string | null;

  @Column({ type: 'jsonb', nullable: true })
  entities: any | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
