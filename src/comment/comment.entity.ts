import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { DocEntity } from '../doc/doc.entity';
import { ResourceEntity } from '../resource/resource.entity';

@Entity({ name: 'comments' })
export class CommentEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => DocEntity, (doc) => doc.comments, { nullable: true })
  doc: DocEntity | null;

  @ManyToOne(() => ResourceEntity, { nullable: true })
  resource: ResourceEntity | null;

  @Column({ type: 'text', nullable: true })
  content?: string;

  // Cita y contexto del fragmento comentado. El cuerpo va en |content|; esto
  // permite que otro cliente (el navegador) vuelva a localizarlo.
  @Column({ type: 'text', nullable: true })
  quote: string | null;

  @Column({ type: 'text', nullable: true })
  prefix: string | null;

  @Column({ type: 'text', nullable: true })
  suffix: string | null;

  @Column({ type: 'int', nullable: true })
  position: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
