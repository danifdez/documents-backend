import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { DocEntity } from '../doc/doc.entity';

@Entity({ name: 'marks' })
export class MarkEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => DocEntity, (doc) => doc.marks, { nullable: true })
  doc: DocEntity | null;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
