import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { DocEntity } from '../doc/doc.entity';
import { ResourceEntity } from '../resource/resource.entity';
import { ThreadEntity } from '../thread/thread.entity';
import { DatasetEntity } from '../dataset/dataset.entity';
import { NoteEntity } from '../note/note.entity';
import { CalendarEventEntity } from '../calendar-event/calendar-event.entity';
import { TimelineEntity } from '../timeline/timeline.entity';
import { UserTaskEntity } from '../user-task/user-task.entity';

@Entity({ name: 'projects' })
export class ProjectEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ length: 16, default: 'active' })
  status: string;

  @OneToMany(() => DocEntity, (doc) => doc.project)
  docs: DocEntity[];

  @OneToMany(() => ResourceEntity, (resource) => resource.project)
  resources: ResourceEntity[];

  @OneToMany(() => ThreadEntity, (thread) => thread.project)
  threads: ThreadEntity[];

  @OneToMany(() => DatasetEntity, (dataset) => dataset.project)
  datasets: DatasetEntity[];

  @OneToMany(() => NoteEntity, (note) => note.project)
  notes: NoteEntity[];

  @OneToMany(() => CalendarEventEntity, (event) => event.project)
  calendarEvents: CalendarEventEntity[];

  @OneToMany(() => TimelineEntity, (timeline) => timeline.project)
  timelines: TimelineEntity[];

  @OneToMany(() => UserTaskEntity, (task) => task.project)
  userTasks: UserTaskEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
