import { Entity, Column, CreateDateColumn, ManyToOne, JoinColumn, PrimaryColumn } from 'typeorm';
import { ResourceEntity } from '../resource/resource.entity';
import { EntityEntity } from '../entity/entity.entity';

@Entity({ name: 'resource_entities' })
export class ResourceEntityEntity {
    @PrimaryColumn({ name: 'resource_id' })
    resourceId: number;

    @PrimaryColumn({ name: 'entity_id' })
    entityId: number;

    @ManyToOne(() => ResourceEntity, { nullable: false })
    @JoinColumn({ name: 'resource_id' })
    resource: ResourceEntity;

    @ManyToOne(() => EntityEntity, { nullable: false })
    @JoinColumn({ name: 'entity_id' })
    entity: EntityEntity;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}