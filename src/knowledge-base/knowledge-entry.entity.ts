import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { EntityEntity } from '../entity/entity.entity';

@Entity({ name: 'knowledge_entries' })
export class KnowledgeEntryEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    title: string;

    @Column({ type: 'text', nullable: true })
    content: string | null;

    @Column({ type: 'text', nullable: true })
    summary: string | null;

    @Column({ type: 'jsonb', nullable: true })
    tags: string[] | null;

    @Column({ name: 'is_definition', default: false })
    isDefinition: boolean;

    @Column({ name: 'entity_id', nullable: true })
    entityId: number | null;

    @ManyToOne(() => EntityEntity, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'entity_id' })
    entity: EntityEntity | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
