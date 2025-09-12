import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany } from 'typeorm';
import { CommentEntity } from '../comment/comment.entity';
import { MarkEntity } from '../mark/mark.entity';
import { ProjectEntity } from '../project/project.entity';
import { ThreadEntity } from '../thread/thread.entity';

@Entity({ name: 'docs' })
export class DocEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @ManyToOne(() => ThreadEntity, (thread) => thread.docs, { nullable: true })
  thread: ThreadEntity | null;

  @ManyToOne(() => ProjectEntity, (project) => project.docs, { nullable: true })
  project: ProjectEntity | null;

  @Column({ type: 'text', nullable: true })
  content?: string;

  @OneToMany(() => CommentEntity, (comment) => comment.doc)
  comments: CommentEntity[];

  @OneToMany(() => MarkEntity, (mark) => mark.doc)
  marks: MarkEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
