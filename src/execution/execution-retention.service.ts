import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExecutionService } from './execution.service';

@Injectable()
export class ExecutionRetentionService {
  private readonly logger = new Logger(ExecutionRetentionService.name);

  constructor(private readonly executions: ExecutionService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async purgeExpiredArtifacts(): Promise<void> {
    try {
      await this.executions.purgeAllExpiredArtifacts(100);
    } catch (error) {
      this.logger.error(
        `Execution artifact retention failed: ${(error as Error).message}`,
      );
    }
  }
}
