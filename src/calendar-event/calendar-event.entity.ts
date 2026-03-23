import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { ProjectEntity } from '../project/project.entity';

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

  @ManyToOne(() => ProjectEntity, (project) => project.calendarEvents, { nullable: true })
  project: ProjectEntity | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
