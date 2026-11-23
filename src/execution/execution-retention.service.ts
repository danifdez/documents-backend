import { claimAvailable } from '../utils/claim-available';
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
      const purgeBatch = async () =>
        (await this.executions.purgeExpiredArtifacts(100)) || null;
      for await (const _ of claimAvailable(purgeBatch)) {
        // Continue until no expired artifacts remain.
      }
    } catch (error) {
      this.logger.error(
        `Execution artifact retention failed: ${(error as Error).message}`,
      );
    }
  }
}
