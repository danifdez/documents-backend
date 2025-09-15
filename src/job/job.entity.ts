import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { JobStatus } from './job-status.enum';

@Entity({ name: 'jobs' })
export class JobEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  type: string;

  @Column({ type: 'varchar', nullable: true, default: 'normal' })
  priority: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: any;

  @Column({ type: 'varchar', default: JobStatus.PENDING })
  status: JobStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  result: any;
}
