import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
} from 'typeorm';
import { DocEntity } from '../doc/doc.entity';
import { ResourceEntity } from '../resource/resource.entity';

export const READING_POINT_KINDS = ['reading', 'section'] as const;

export type ReadingPointKind = (typeof READING_POINT_KINDS)[number];

@Entity({ name: 'reading_points' })
export class ReadingPointEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => DocEntity, { nullable: true })
  doc: DocEntity | null;

  @ManyToOne(() => ResourceEntity, { nullable: true })
  resource: ResourceEntity | null;

  // 'reading' = la marca única desde la que continuar; 'section' = un punto de
  // libro con nombre. Solo puede haber una marca de lectura por documento o
  // recurso, lo garantizan los índices parciales de la migración.
  @Column({ type: 'varchar', length: 16, default: 'section' })
  kind: ReadingPointKind;

  // Nombre del punto de libro. Vacío en las marcas de lectura.
  @Column({ type: 'text', nullable: true })
  label: string | null;

  // Id de un encabezado o bloque estable al que anclar el punto, si lo hay.
  @Column({ name: 'fragmentId', type: 'text', nullable: true })
  fragmentId: string | null;

  @Column({ type: 'text', nullable: true })
  exact: string | null;

  // Contexto del fragmento en el texto llano. Permite que otro cliente
  // (el navegador) vuelva a localizar el punto al mostrar la página.
  @Column({ type: 'text', nullable: true })
  prefix: string | null;

  @Column({ type: 'text', nullable: true })
  suffix: string | null;

  @Column({ type: 'int', default: 0 })
  position: number;

  // Avance de scroll [0,1]. Es el último recurso cuando el texto ya no aparece.
  @Column({ type: 'double precision', default: 0 })
  ratio: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
