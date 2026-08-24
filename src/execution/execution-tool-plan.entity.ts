import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ToolPlanContract } from './execution-tool.types';

@Entity({ name: 'execution_tool_plans' })
@Index('UQ_execution_tool_plans_tool_call', ['toolCallId'], { unique: true })
@Index('UQ_execution_tool_plans_step', ['stepId'], { unique: true })
@Index('IDX_execution_tool_plans_execution', ['executionId', 'createdAt'])
export class ExecutionToolPlanEntity {
  @PrimaryColumn({ name: 'operation_id', type: 'uuid' })
  operationId: string;

  @Column({ name: 'execution_id', type: 'uuid' })
  executionId: string;

  @Column({ name: 'tool_call_id', type: 'uuid' })
  toolCallId: string;

  @Column({ name: 'step_id', type: 'uuid', nullable: true })
  stepId: string | null;

  @Column({ name: 'schema_version', type: 'varchar', length: 50 })
  schemaVersion: string;

  @Column({ name: 'tool_name', type: 'varchar', length: 200 })
  toolName: string;

  @Column({ type: 'jsonb' })
  plan: ToolPlanContract;

  @Column({ name: 'plan_hash', type: 'varchar', length: 71 })
  planHash: string;

  @Column({ name: 'materialized_at', type: 'timestamptz', nullable: true })
  materializedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
