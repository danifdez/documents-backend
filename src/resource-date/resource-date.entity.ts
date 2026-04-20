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
export type DateResolver = 'dateparser' | 'llm' | 'unresolved';

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

  @Column({ type: 'varchar', length: 16 })
  resolver: DateResolver;

  @Column({ name: 'is_relative', type: 'boolean', default: false })
  isRelative: boolean;

  @Column({ name: 'unresolved_reason', type: 'varchar', length: 32, nullable: true })
  unresolvedReason: string | null;

  @Column({ name: 'anchor_date_used', type: 'date', nullable: true })
  anchorDateUsed: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
