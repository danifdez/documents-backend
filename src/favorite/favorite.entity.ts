import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
} from 'typeorm';
import { ProjectEntity } from '../project/project.entity';

// Un favorito del proyecto: un puntero ligero a una página web (url + título).
//
// No es un recurso: no tiene fichero, no se indexa y no pasa por extracción. Es
// lo que el navegador guarda desde su botón ☆ para volver rápido a una página,
// dentro del proyecto con el que está conectado.
@Entity({ name: 'favorites' })
export class FavoriteEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ProjectEntity, { nullable: false, onDelete: 'CASCADE' })
  project: ProjectEntity;

  @Column()
  url: string;

  @Column({ default: '' })
  title: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
