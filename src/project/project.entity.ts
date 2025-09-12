import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { DocEntity } from '../doc/doc.entity';
import { ResourceEntity } from '../resource/resource.entity';
import { ThreadEntity } from '../thread/thread.entity';

@Entity({ name: 'projects' })
export class ProjectEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ nullable: true })
  description?: string;

  @OneToMany(() => DocEntity, (doc) => doc.project)
  docs: DocEntity[];

  @OneToMany(() => ResourceEntity, (resource) => resource.project)
  resources: ResourceEntity[];

  @OneToMany(() => ThreadEntity, (thread) => thread.project)
  threads: ThreadEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
