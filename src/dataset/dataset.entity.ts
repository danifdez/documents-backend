import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { ProjectEntity } from '../project/project.entity';
import { DatasetRecordEntity } from './dataset-record.entity';
import { DataSourceEntity } from '../data-source/data-source.entity';

export interface DatasetField {
    key: string;
    name: string;
    type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'time' | 'select';
    required: boolean;
    options?: string[];
    linkedDatasetId?: number;
    linkedLookupField?: string;
    linkedDisplayField?: string;
}

@Entity({ name: 'datasets' })
export class DatasetEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @ManyToOne(() => ProjectEntity, (project) => project.datasets, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'project_id' })
    project: ProjectEntity | null;

    @Column({ type: 'jsonb', default: '[]' })
    schema: DatasetField[];

    @OneToMany(() => DatasetRecordEntity, (record) => record.dataset)
    records: DatasetRecordEntity[];

    @OneToMany(() => DataSourceEntity, (ds) => ds.dataset)
    dataSources: DataSourceEntity[];

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
