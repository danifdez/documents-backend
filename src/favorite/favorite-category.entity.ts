import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { ProjectEntity } from '../project/project.entity';

@Entity({ name: 'favorite_categories' })
export class FavoriteCategoryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ProjectEntity, { nullable: false, onDelete: 'CASCADE' })
  project: ProjectEntity;

  @Column({ name: 'parentId', nullable: true })
  parentId: number | null;

  @ManyToOne(() => FavoriteCategoryEntity, (category) => category.children, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parentId' })
  parent: FavoriteCategoryEntity | null;

  @OneToMany(() => FavoriteCategoryEntity, (category) => category.parent)
  children: FavoriteCategoryEntity[];

  @Column()
  name: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
