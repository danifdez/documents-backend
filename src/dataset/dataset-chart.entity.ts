import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { DatasetEntity } from './dataset.entity';

@Entity({ name: 'dataset_charts' })
export class DatasetChartEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => DatasetEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'dataset_id' })
    dataset: DatasetEntity;

    @Column()
    name: string;

    @Column({ type: 'jsonb', default: '{}' })
    config: Record<string, any>;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
