import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { ProjectEntity } from '../project/project.entity';

export type TimelineLayoutType = 'horizontal' | 'vertical';

export interface TimelineEpoch {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  color: string;
}

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

  @Column({ type: 'jsonb', nullable: true })
  epochs: TimelineEpoch[] | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'sync_dataset_id', nullable: true })
  syncDatasetId: number | null;

  @Column({ type: 'jsonb', nullable: true, name: 'sync_mapping' })
  syncMapping: Record<string, string> | null;

  @Column({ name: 'layout_type', default: 'horizontal' })
  layoutType: TimelineLayoutType;

  @Column({ name: 'axis_breaks', default: false })
  axisBreaks: boolean;

  @ManyToOne(() => ProjectEntity, (project) => project.timelines, { nullable: true })
  project: ProjectEntity | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
