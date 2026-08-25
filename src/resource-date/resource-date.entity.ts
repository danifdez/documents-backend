import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ResourceEntity } from '../resource/resource.entity';

export type DatePrecision = 'day' | 'month' | 'year';

@Entity({ name: 'resource_dates' })
@Index(['resourceId', 'date'])
export class ResourceDateEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'resource_id' })
  resourceId: number;

  @ManyToOne(() => ResourceEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'resource_id' })
  resource: ResourceEntity;

  @Column({ type: 'date', nullable: true })
  date: string | null;

  @Column({ type: 'date', name: 'end_date', nullable: true })
  endDate: string | null;

  @Column({ name: 'raw_expression' })
  rawExpression: string;

  @Column({ type: 'varchar', length: 8, nullable: true })
  precision: DatePrecision | null;

  @Column({ name: 'char_offset', type: 'int', nullable: true })
  charOffset: number | null;

  @Column({ name: 'context_snippet', type: 'text', nullable: true })
  contextSnippet: string | null;

  @Column({
    name: 'unresolved_reason',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  unresolvedReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
