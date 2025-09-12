import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany } from 'typeorm';
import { DocEntity } from '../doc/doc.entity';
import { ProjectEntity } from '../project/project.entity';

@Entity({ name: 'threads' })
export class ThreadEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: false })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ManyToOne(() => ProjectEntity, (doc) => doc.threads, { nullable: true })
  project: ProjectEntity | null;

  @Column({ nullable: true })
  parent?: number;

  @OneToMany(() => DocEntity, (doc) => doc.thread)
  docs: DocEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
