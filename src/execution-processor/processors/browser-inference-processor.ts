import { Injectable } from '@nestjs/common';
import { ExecutionEntity } from '../../execution/execution.entity';
import { ExecutionProcessor } from '../execution-processor.interface';

@Injectable()
export class BrowserInferenceProcessor implements ExecutionProcessor {
  canProcess(taskType: string): boolean {
    return taskType === 'browser-inference';
  }

  async process(execution: ExecutionEntity) {
    const result = execution.result as Record<string, unknown> | null;
    if (!result || typeof result.content !== 'string') {
      return { success: false, reason: 'invalid_browser_inference_result' };
    }
    return { success: true };
  }
}
