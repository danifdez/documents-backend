import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { ProjectEntity } from '../project/project.entity';

export interface AlarmDescriptor {
  offsetMinutes: number;
  label?: string;
}

@Entity({ name: 'calendar_events' })
export class CalendarEventEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'timestamptz', name: 'start_date' })
  startDate: Date;

  @Column({ type: 'timestamptz', name: 'end_date', nullable: true })
  endDate: Date | null;

  @Column({ nullable: true, default: '#3b82f6' })
  color: string;

  @Column({ default: false, name: 'all_day' })
  allDay: boolean;

  @Column({ type: 'text', name: 'recurrence_rule', nullable: true })
  recurrenceRule: string | null;

  @Column({ type: 'jsonb', nullable: true })
  alarm: AlarmDescriptor | null;

  @Column({ type: 'boolean', default: false, name: 'track_completion' })
  trackCompletion: boolean;

  @ManyToOne(() => ProjectEntity, (project) => project.calendarEvents, { nullable: true })
  project: ProjectEntity | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
