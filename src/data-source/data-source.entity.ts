import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ProjectEntity } from '../project/project.entity';
import { DatasetEntity } from '../dataset/dataset.entity';

@Entity({ name: 'data_sources' })
export class DataSourceEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ name: 'provider_type' })
    providerType: string;

    @Column({ type: 'jsonb', default: '{}' })
    config: Record<string, any>;

    @Column({ type: 'jsonb', nullable: true })
    credentials: string | null;

    @Column({ type: 'jsonb', nullable: true, name: 'schema_mapping' })
    schemaMapping: FieldMapping[] | null;

    @Column({ nullable: true, name: 'sync_schedule' })
    syncSchedule: string | null;

    @Column({ name: 'sync_strategy', default: 'full' })
    syncStrategy: 'full' | 'incremental';

    @Column({ nullable: true, name: 'incremental_key' })
    incrementalKey: string | null;

    @Column({ type: 'timestamp', nullable: true, name: 'last_sync_at' })
    lastSyncAt: Date | null;

    @Column({ nullable: true, name: 'last_sync_status' })
    lastSyncStatus: 'success' | 'failed' | 'running' | null;

    @Column({ type: 'text', nullable: true, name: 'last_sync_error' })
    lastSyncError: string | null;

    @Column({ type: 'int', nullable: true, name: 'last_sync_record_count' })
    lastSyncRecordCount: number | null;

    @ManyToOne(() => DatasetEntity, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'dataset_id' })
    dataset: DatasetEntity | null;

    @ManyToOne(() => ProjectEntity, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'project_id' })
    project: ProjectEntity | null;

    @Column({ default: true })
    enabled: boolean;

    @Column({ type: 'int', nullable: true, name: 'rate_limit_rpm' })
    rateLimitRpm: number | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}

export interface FieldMapping {
    sourceField: string;
    targetFieldKey: string;
    targetFieldName: string;
    targetFieldType: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'time' | 'select';
    transform?: 'none' | 'to_number' | 'to_date' | 'to_boolean' | 'uppercase' | 'lowercase' | 'trim';
}
