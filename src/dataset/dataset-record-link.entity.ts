import { Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { DatasetRelationEntity } from './dataset-relation.entity';
import { DatasetRecordEntity } from './dataset-record.entity';

@Entity({ name: 'dataset_record_links' })
@Unique(['relation', 'sourceRecord', 'targetRecord'])
export class DatasetRecordLinkEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => DatasetRelationEntity, (rel) => rel.links, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'relation_id' })
    relation: DatasetRelationEntity;

    @ManyToOne(() => DatasetRecordEntity, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'source_record_id' })
    sourceRecord: DatasetRecordEntity;

    @ManyToOne(() => DatasetRecordEntity, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'target_record_id' })
    targetRecord: DatasetRecordEntity;
}
