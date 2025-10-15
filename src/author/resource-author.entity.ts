import { Entity, Column, CreateDateColumn, ManyToOne, JoinColumn, PrimaryColumn } from 'typeorm';
import { ResourceEntity } from '../resource/resource.entity';
import { AuthorEntity } from '../author/author.entity';

@Entity({ name: 'resource_authors' })
export class ResourceAuthorEntity {
    @PrimaryColumn({ name: 'resource_id' })
    resourceId: number;

    @PrimaryColumn({ name: 'author_id' })
    authorId: number;

    @ManyToOne(() => ResourceEntity, { nullable: false })
    @JoinColumn({ name: 'resource_id' })
    resource: ResourceEntity;

    @ManyToOne(() => AuthorEntity, { nullable: false })
    @JoinColumn({ name: 'author_id' })
    author: AuthorEntity;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
