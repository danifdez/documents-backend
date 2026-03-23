import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { DatasetEntity } from './dataset.entity';
import { DatasetRecordLinkEntity } from './dataset-record-link.entity';

@Entity({ name: 'dataset_relations' })
export class DatasetRelationEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    name: string | null;

    @ManyToOne(() => DatasetEntity, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'source_dataset_id' })
    sourceDataset: DatasetEntity;

    @ManyToOne(() => DatasetEntity, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'target_dataset_id' })
    targetDataset: DatasetEntity;

    @Column({ name: 'relation_type' })
    relationType: string;

    @OneToMany(() => DatasetRecordLinkEntity, (link) => link.relation)
    links: DatasetRecordLinkEntity[];

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
