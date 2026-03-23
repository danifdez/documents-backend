import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { ProjectEntity } from '../project/project.entity';

export interface TimelineEvent {
  id: string;
  title: string;
  description?: string;
  date: string;
  endDate?: string;
  color: string;
  docId?: number;
  resourceId?: number;
}

@Entity({ name: 'timelines' })
export class TimelineEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ type: 'jsonb', nullable: true, name: 'timeline_data' })
  timelineData: TimelineEvent[] | null;

  @ManyToOne(() => ProjectEntity, (project) => project.timelines, { nullable: true })
  project: ProjectEntity | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
