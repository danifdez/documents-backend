import { ProjectEntity } from '../project/project.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { EntityEntity } from '../entity/entity.entity';
import { AuthorEntity } from '../author/author.entity';

@Entity({ name: 'resources' })
export class ResourceEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ProjectEntity, (project) => project.resources, { nullable: true })
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

  @Column({ type: 'int', nullable: true })
  pages: number | null;

  @Column({ nullable: true })
  path: string | null;

  @Column({ nullable: true })
  url: string | null;

  @Column({ nullable: true })
  title: string | null;

  @Column({ name: 'publication_date', nullable: true })
  publicationDate: string | null;

  @ManyToMany(() => AuthorEntity, (author) => author.resources)
  @JoinTable({
    name: 'resource_authors',
    joinColumn: {
      name: 'resource_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'author_id',
      referencedColumnName: 'id',
    },
  })
  authors: AuthorEntity[];

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

  @Column({ nullable: true })
  license: string | null;

  @Column({ name: 'confirmation_status', default: 'confirmed' })
  confirmationStatus: string;

  @ManyToMany(() => EntityEntity, (entity) => entity.resources)
  @JoinTable({
    name: 'resource_entities',
    joinColumn: {
      name: 'resource_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'entity_id',
      referencedColumnName: 'id',
    },
  })
  entities: EntityEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
