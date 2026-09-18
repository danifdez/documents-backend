import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { DocEntity } from '../doc/doc.entity';
import { ResourceEntity } from '../resource/resource.entity';

export const MARK_TYPES = ['idea', 'important', 'review', 'highlight'] as const;

export type MarkType = (typeof MARK_TYPES)[number];

@Entity({ name: 'marks' })
export class MarkEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => DocEntity, (doc) => doc.marks, { nullable: true })
  doc: DocEntity | null;

  @ManyToOne(() => ResourceEntity, { nullable: true })
  resource: ResourceEntity | null;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  // Ancla del fragmento en el texto llano. Permite que otro cliente (el
  // navegador) vuelva a localizar la cita al mostrarla fuera del documento.
  @Column({ type: 'text', nullable: true })
  prefix: string | null;

  @Column({ type: 'text', nullable: true })
  suffix: string | null;

  @Column({ type: 'int', nullable: true })
  position: number | null;

  @Column({ type: 'varchar', length: 16, default: 'highlight' })
  type: MarkType;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
