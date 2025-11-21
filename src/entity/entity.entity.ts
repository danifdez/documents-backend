import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, ManyToMany, JoinColumn, JoinTable } from 'typeorm';
import { EntityTypeEntity } from '../entity-type/entity-type.entity';
import { ResourceEntity } from '../resource/resource.entity';
import { ProjectEntity } from '../project/project.entity';

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

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ type: 'boolean', default: false })
    global: boolean;

    @Column({ type: 'jsonb', nullable: true })
    translations: EntityTranslation | null;

    @Column({ type: 'jsonb', nullable: true })
    aliases: EntityAlias[] | null;

    @ManyToOne(() => EntityTypeEntity, (entityType) => entityType.entities, { nullable: false })
    @JoinColumn({ name: 'entity_type_id' })
    entityType: EntityTypeEntity;

    @ManyToMany(() => ResourceEntity, { cascade: ['insert'] })
    resources: ResourceEntity[];

    @ManyToMany(() => ProjectEntity, { cascade: ['insert'] })
    @JoinTable({
        name: 'entity_projects',
        joinColumn: { name: 'entity_id', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'project_id', referencedColumnName: 'id' }
    })
    projects: ProjectEntity[];

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}