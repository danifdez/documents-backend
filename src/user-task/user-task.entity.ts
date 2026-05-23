import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { ProjectEntity } from '../project/project.entity';

@Entity({ name: 'user_tasks' })
export class UserTaskEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: 'pending' | 'completed';

  @Column({ type: 'timestamptz', name: 'reminder_at', nullable: true })
  reminderAt: Date | null;

  @ManyToOne(() => ProjectEntity, (project) => project.userTasks, { nullable: true })
  project: ProjectEntity | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
