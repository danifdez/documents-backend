import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { DatasetEntity } from './dataset.entity';
import { ResourceEntity } from '../resource/resource.entity';
import { CellAnchor, ExtractionStatus } from './cell-anchor.type';

@Entity({ name: 'dataset_records' })
export class DatasetRecordEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => DatasetEntity, (dataset) => dataset.records, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'dataset_id' })
    dataset: DatasetEntity;

    @Column({ type: 'jsonb', default: '{}' })
    data: Record<string, any>;

    @Column({ name: 'cell_metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
    cellMetadata: Record<string, CellAnchor>;

    @ManyToOne(() => ResourceEntity, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'source_resource_id' })
    sourceResource: ResourceEntity | null;

    @Column({ name: 'source_resource_id', type: 'int', nullable: true })
    sourceResourceId: number | null;

    @Column({ name: 'extraction_status', type: 'varchar', length: 16, default: 'extracted' })
    extractionStatus: ExtractionStatus;

    @Column({ name: 'extraction_error', type: 'text', nullable: true, default: null })
    extractionError: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
