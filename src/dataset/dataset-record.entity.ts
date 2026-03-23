import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { DatasetEntity } from './dataset.entity';

@Entity({ name: 'dataset_records' })
export class DatasetRecordEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => DatasetEntity, (dataset) => dataset.records, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'dataset_id' })
    dataset: DatasetEntity;

    @Column({ type: 'jsonb', default: '{}' })
    data: Record<string, any>;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
