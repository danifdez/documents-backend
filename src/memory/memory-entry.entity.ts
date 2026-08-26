import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AssistantEntity } from '../assistant/assistant.entity';
import { AgentEntity } from '../agent/agent.entity';

export type MemoryEntryType = 'fact' | 'preference' | 'episode';
export type MemorySourceKind = 'manual' | 'confirmed_tool' | 'import';
export type MemoryConsentBasis =
  'explicit_user_action' | 'confirmed_tool_plan' | 'imported_with_consent';

@Entity({ name: 'memory_entries' })
@Check(
  'CHK_memory_entries_owner',
  '(assistant_id IS NOT NULL)::integer + (agent_id IS NOT NULL)::integer = 1',
)
@Index('IDX_memory_entries_assistant_updated', ['assistantId', 'updatedAt'])
@Index('IDX_memory_entries_agent_updated', ['agentId', 'updatedAt'])
export class MemoryEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'assistant_id', type: 'integer', nullable: true })
  assistantId: number | null;

  @ManyToOne(() => AssistantEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assistant_id' })
  assistant: AssistantEntity | null;

  @Column({ name: 'agent_id', type: 'integer', nullable: true })
  agentId: number | null;

  @ManyToOne(() => AgentEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent: AgentEntity | null;

  @Column({ length: 120 })
  name: string;

  @Column({ length: 16 })
  type: MemoryEntryType;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'content_hash', length: 71 })
  contentHash: string;

  @Column({ name: 'source_kind', length: 24 })
  sourceKind: MemorySourceKind;

  @Column({ name: 'source_execution_id', type: 'uuid', nullable: true })
  sourceExecutionId: string | null;

  @Column({ name: 'source_turn_id', type: 'uuid', nullable: true })
  sourceTurnId: string | null;

  @Column({ name: 'source_message_id', type: 'integer', nullable: true })
  sourceMessageId: number | null;

  @Column({ name: 'source_artifact_id', type: 'uuid', nullable: true })
  sourceArtifactId: string | null;

  @Column({ name: 'source_artifact_revision', type: 'integer', nullable: true })
  sourceArtifactRevision: number | null;

  @Column({ name: 'consent_status', length: 16 })
  consentStatus: 'granted';

  @Column({ name: 'consent_basis', length: 32 })
  consentBasis: MemoryConsentBasis;

  @Column({ name: 'consented_at', type: 'timestamptz' })
  consentedAt: Date;

  @Column({ name: 'data_classification', length: 24 })
  dataClassification: 'workspace';

  @Column({ length: 32 })
  purpose: 'conversation_memory';

  @Column({
    name: 'allowed_destinations',
    type: 'text',
    array: true,
    default: () => "'{documents,documents-models}'::text[]",
  })
  allowedDestinations: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
