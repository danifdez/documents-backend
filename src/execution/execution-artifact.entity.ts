import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'execution_artifacts' })
@Index('IDX_execution_artifacts_hash', ['rootExecutionId', 'contentHash'])
export class ExecutionArtifactEntity {
  @PrimaryColumn({ name: 'artifact_id', type: 'uuid' })
  artifactId: string;

  @Column({ name: 'root_execution_id', type: 'uuid' })
  rootExecutionId: string;

  @Column({ type: 'varchar', length: 80 })
  kind: string;

  @Column({ name: 'content_hash', type: 'varchar', length: 71 })
  contentHash: string;

  @Column({ type: 'bigint' })
  size: string;

  @Column({ name: 'media_type', type: 'varchar', length: 200 })
  mediaType: string;

  @Column({ type: 'varchar', length: 20, default: 'identity' })
  encoding: string;

  @Column({ name: 'data_classification', type: 'varchar', length: 30 })
  dataClassification: string;

  @Column({ type: 'jsonb', default: () => '\'{"applied":false}\'::jsonb' })
  redaction: Record<string, unknown>;

  @Column({ name: 'retention_class', type: 'varchar', length: 30 })
  retentionClass: string;

  @Column({ name: 'created_by_event_id', type: 'uuid', nullable: true })
  createdByEventId: string | null;

  @Column({
    name: 'input_source_ids',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  inputSourceIds: string[];

  @Column({ name: 'storage_ref', type: 'varchar', length: 500 })
  storageRef: string;

  @Column({ type: 'bytea', nullable: true, select: false })
  body: Buffer | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
