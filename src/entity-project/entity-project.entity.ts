import { Entity, CreateDateColumn, ManyToOne, JoinColumn, PrimaryColumn } from 'typeorm';
import { EntityEntity } from '../entity/entity.entity';
import { ProjectEntity } from '../project/project.entity';

@Entity({ name: 'entity_projects' })
export class EntityProjectEntity {
    @PrimaryColumn({ name: 'entity_id' })
    entityId: number;

    @PrimaryColumn({ name: 'project_id' })
    projectId: number;

    @ManyToOne(() => EntityEntity, { nullable: false })
    @JoinColumn({ name: 'entity_id' })
    entity: EntityEntity;

    @ManyToOne(() => ProjectEntity, { nullable: false })
    @JoinColumn({ name: 'project_id' })
    project: ProjectEntity;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
