import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'execution_artifacts' })
@Index('IDX_execution_artifacts_hash', ['rootExecutionId', 'contentHash'])
@Index('IDX_execution_artifacts_retention', ['contentState', 'expiresAt'])
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

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'content_state', type: 'varchar', length: 20 })
  contentState: 'active' | 'expired' | 'withdrawn';

  @Column({
    name: 'withdrawal_reason',
    type: 'varchar',
    length: 240,
    nullable: true,
  })
  withdrawalReason: string | null;

  @Column({ name: 'content_deleted_at', type: 'timestamptz', nullable: true })
  contentDeletedAt: Date | null;

  @Column({ name: 'created_by_event_id', type: 'uuid', nullable: true })
  createdByEventId: string | null;

  @Column({ name: 'produced_by_attempt_id', type: 'uuid', nullable: true })
  producedByAttemptId: string | null;

  @Column({
    name: 'input_source_ids',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  inputSourceIds: string[];

  @Column({
    name: 'derived_from_artifact_ids',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  derivedFromArtifactIds: string[];

  @Column({ name: 'storage_ref', type: 'varchar', length: 500 })
  storageRef: string;

  @Column({ type: 'bytea', nullable: true, select: false })
  body: Buffer | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
