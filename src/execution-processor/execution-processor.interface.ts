import { ExecutionEntity } from '../execution/execution.entity';
import { ExecutionPublication } from '../execution-outbox/execution-publication';

export interface ExecutionProcessorResult {
  success: boolean;
  message?: string;
  reason?: string;
  publication?: ExecutionPublication;
  [key: string]: unknown;
}

export interface ExecutionProcessor {
  process(execution: ExecutionEntity): Promise<ExecutionProcessorResult>;
  canProcess(taskType: string): boolean;
}
