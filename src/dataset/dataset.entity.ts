import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { ProjectEntity } from '../project/project.entity';
import { DatasetRecordEntity } from './dataset-record.entity';
import { DataSourceEntity } from '../data-source/data-source.entity';

/**
 * Schema of a single column inside a Dataset.
 *
 * `description` is injected verbatim into the extraction worker's prompt
 * (see worker `dataset.extract-row`). It is the semantic guide that tells
 * the model what to look for; without it, autoextraction across many
 * sources tends to drift. Optional so legacy manual datasets stay valid.
 */
export interface DatasetField {
    key: string;
    name: string;
    description?: string;
    type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'time' | 'select';
    required: boolean;
    options?: string[];
    linkedDatasetId?: number;
    linkedLookupField?: string;
    linkedDisplayField?: string;
}

export type DatasetSourceMode = 'manual' | 'project_resources' | 'resource_selection';

export interface DatasetExtractionConfig {
    model: string;
    promptVersion: string;
    lastRunAt: string | null;
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

    @Column({ name: 'source_mode', type: 'varchar', length: 32, default: 'manual' })
    sourceMode: DatasetSourceMode;

    @Column({ name: 'source_config', type: 'jsonb', default: () => "'{}'::jsonb" })
    sourceConfig: Record<string, any>;

    @Column({ name: 'extraction_config', type: 'jsonb', nullable: true, default: null })
    extractionConfig: DatasetExtractionConfig | null;

    @OneToMany(() => DatasetRecordEntity, (record) => record.dataset)
    records: DatasetRecordEntity[];

    @OneToMany(() => DataSourceEntity, (ds) => ds.dataset)
    dataSources: DataSourceEntity[];

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
