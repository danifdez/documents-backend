import { Injectable } from '@nestjs/common';
import { ExecutionProcessor } from '../execution-processor.interface';
import { ExecutionEntity } from 'src/execution/execution.entity';
import { ResourceDateService } from 'src/resource-date/resource-date.service';
import { ResourceDatePayload } from 'src/resource-date/dto/resource-date.dto';

@Injectable()
export class DateExtractionProcessor implements ExecutionProcessor {
  private readonly TASK_TYPE = 'date-extraction';

  constructor(private readonly resourceDateService: ResourceDateService) {}

  canProcess(taskType: string): boolean {
    return taskType === this.TASK_TYPE;
  }

  async process(execution: ExecutionEntity): Promise<any> {
    const resourceId = Number(execution.payload['resourceId']);
    const result = execution.result as { dates?: ResourceDatePayload[] };

    if (!resourceId || isNaN(resourceId)) {
      throw new Error(
        `Invalid resourceId in date-extraction execution: ${resourceId}`,
      );
    }
    if (!result || !Array.isArray(result.dates)) {
      throw new Error(
        `Invalid execution result for date-extraction on resource ${resourceId}`,
      );
    }

    const saved = await this.resourceDateService.replaceByResourceId(
      resourceId,
      result.dates,
    );

    return { success: true, resourceId, datesExtracted: saved.length };
  }
}
