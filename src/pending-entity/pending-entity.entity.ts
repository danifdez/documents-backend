import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { EntityTypeEntity } from '../entity-type/entity-type.entity';
import { ResourceEntity } from '../resource/resource.entity';

export type EntityScope = 'document' | 'project' | 'global';

export interface EntityAlias {
    locale: string;
    value: string;
    scope: EntityScope; // Scope of the alias: document, project, or global
}

export interface EntityTranslation {
    [locale: string]: string;
}

@Entity({ name: 'pending_entities' })
export class PendingEntityEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'resource_id' })
    resourceId: number;

    @ManyToOne(() => ResourceEntity, { nullable: false })
    @JoinColumn({ name: 'resource_id' })
    resource: ResourceEntity;

    @Column()
    name: string;

    @Column({ nullable: true })
    language: string | null;

    @Column({ type: 'jsonb', nullable: true })
    translations: EntityTranslation | null;

    @Column({ type: 'jsonb', nullable: true })
    aliases: EntityAlias[] | null;

    @Column({ name: 'scope', type: 'varchar', default: 'document' })
    scope: EntityScope;

    @Column({ name: 'status', type: 'varchar', default: 'pending' })
    status: 'pending' | 'merged';

    @Column({ name: 'merged_target_type', type: 'varchar', nullable: true })
    mergedTargetType: 'pending' | 'confirmed' | null;

    @Column({ name: 'merged_target_id', type: 'integer', nullable: true })
    mergedTargetId: number | null;

    @Column({ name: 'merged_at', type: 'timestamp', nullable: true })
    mergedAt: Date | null;

    @ManyToOne(() => EntityTypeEntity, (entityType) => entityType.entities, { nullable: true })
    @JoinColumn({ name: 'entity_type_id' })
    entityType: EntityTypeEntity | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
