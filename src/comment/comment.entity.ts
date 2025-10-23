import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { DocEntity } from '../doc/doc.entity';
import { ResourceEntity } from '../resource/resource.entity';

@Entity({ name: 'comments' })
export class CommentEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => DocEntity, (doc) => doc.comments, { nullable: true })
  doc: DocEntity | null;

  @ManyToOne(() => ResourceEntity, { nullable: true })
  resource: ResourceEntity | null;

  @Column({ type: 'text', nullable: true })
  content?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
