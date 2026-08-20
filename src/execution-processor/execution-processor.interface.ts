import { ExecutionEntity } from 'src/execution/execution.entity';

export interface ExecutionProcessor {
  process(execution: ExecutionEntity): Promise<any>;
  canProcess(taskType: string): boolean;
}
