import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, ManyToMany, JoinColumn } from 'typeorm';
import { EntityTypeEntity } from '../entity-type/entity-type.entity';
import { ResourceEntity } from '../resource/resource.entity';

export interface EntityTranslation {
    [locale: string]: string;
}

export interface EntityAlias {
    locale: string;
    value: string;
}

@Entity({ name: 'entities' })
export class EntityEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column({ type: 'jsonb', nullable: true })
    translations: EntityTranslation | null;

    @Column({ type: 'jsonb', nullable: true })
    aliases: EntityAlias[] | null;

    @ManyToOne(() => EntityTypeEntity, (entityType) => entityType.entities, { nullable: false })
    @JoinColumn({ name: 'entity_type_id' })
    entityType: EntityTypeEntity;

    @ManyToMany(() => ResourceEntity, { cascade: ['insert'] })
    resources: ResourceEntity[];

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}