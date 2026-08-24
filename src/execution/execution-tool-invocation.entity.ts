import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { ToolInvocationContract } from './execution-tool.types';

@Entity({ name: 'execution_tool_invocations' })
@Index('IDX_execution_tool_invocations_execution', ['executionId', 'createdAt'])
export class ExecutionToolInvocationEntity {
  @PrimaryColumn({ name: 'tool_call_id', type: 'uuid' })
  toolCallId: string;

  @Column({ name: 'execution_id', type: 'uuid' })
  executionId: string;

  @Column({ name: 'caused_by_event_id', type: 'uuid' })
  causedByEventId: string;

  @Column({ name: 'schema_version', type: 'varchar', length: 50 })
  schemaVersion: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'jsonb' })
  invocation: ToolInvocationContract;

  @Column({ name: 'invocation_hash', type: 'varchar', length: 71 })
  invocationHash: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
