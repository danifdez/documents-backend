import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { ProjectEntity } from '../project/project.entity';
import { ThreadEntity } from '../thread/thread.entity';

@Entity({ name: 'notes' })
export class NoteEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @ManyToOne(() => ProjectEntity, (project) => project.notes, { nullable: true })
  project: ProjectEntity | null;

  @ManyToOne(() => ThreadEntity, { nullable: true })
  thread: ThreadEntity | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
