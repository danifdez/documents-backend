import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
} from 'typeorm';
import { CalendarEventEntity } from './calendar-event.entity';

@Entity({ name: 'event_occurrence_completion' })
@Index('uq_event_occurrence', ['event', 'occurrenceDate'], { unique: true })
export class EventOccurrenceCompletionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => CalendarEventEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'event_id' })
  event: CalendarEventEntity;

  @Column({ type: 'timestamptz', name: 'occurrence_date' })
  occurrenceDate: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'completed_at' })
  completedAt: Date;
}
