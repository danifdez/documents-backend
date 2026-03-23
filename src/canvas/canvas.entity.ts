import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { ProjectEntity } from '../project/project.entity';
import { ThreadEntity } from '../thread/thread.entity';

@Entity({ name: 'canvases' })
export class CanvasEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ type: 'jsonb', name: 'canvas_data', nullable: true })
  canvasData: object | null;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @ManyToOne(() => ThreadEntity, { nullable: true })
  thread: ThreadEntity | null;

  @ManyToOne(() => ProjectEntity, { nullable: true })
  project: ProjectEntity | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
