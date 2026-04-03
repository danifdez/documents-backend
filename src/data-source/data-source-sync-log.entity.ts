import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { DataSourceEntity } from './data-source.entity';

@Entity({ name: 'data_source_sync_logs' })
export class DataSourceSyncLogEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => DataSourceEntity, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'data_source_id' })
    dataSource: DataSourceEntity;

    @Column()
    status: 'success' | 'failed' | 'partial' | 'running';

    @Column({ type: 'timestamp', name: 'started_at' })
    startedAt: Date;

    @Column({ type: 'timestamp', nullable: true, name: 'finished_at' })
    finishedAt: Date | null;

    @Column({ type: 'int', default: 0, name: 'records_fetched' })
    recordsFetched: number;

    @Column({ type: 'int', default: 0, name: 'records_created' })
    recordsCreated: number;

    @Column({ type: 'int', default: 0, name: 'records_updated' })
    recordsUpdated: number;

    @Column({ type: 'text', nullable: true, name: 'error_message' })
    errorMessage: string | null;
}
