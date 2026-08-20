import { Injectable, Logger } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from 'src/execution/execution.entity';

@Injectable()
export class DeleteVectorsProcessor implements ExecutionProcessor {
  private readonly logger = new Logger(DeleteVectorsProcessor.name);
  private readonly TASK_TYPE = 'delete-vectors';

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    this.logger.log(
      `Vectors deleted for source: ${execution.payload['sourceId']}`,
    );
  }
}
