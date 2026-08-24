import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as os from 'os';
import * as process from 'process';
import { ExecutionCoordinatorService } from 'src/execution-coordinator/execution-coordinator.service';
import { WorkerService } from 'src/worker/worker.service';
import { ExecutionAttemptService } from 'src/execution/execution-attempt.service';

const FINALIZATION_STALE_AFTER_MS = 5 * 60 * 1000;

@Injectable()
export class TaskScheduleService {
  private readonly logger = new Logger(TaskScheduleService.name);

  constructor(
    private readonly executionCoordinatorService: ExecutionCoordinatorService,
    private readonly workerService: WorkerService,
    private readonly executionAttemptService: ExecutionAttemptService,
  ) {}

  private getCPUAndMemoryUsage() {
    const cpuCount = os.cpus().length;
    const loadAvg = os.loadavg()[0];
    const cpuUsagePercent = (loadAvg / cpuCount) * 100;
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsagePercent = (usedMemory / totalMemory) * 100;

    const processMemoryUsage = process.memoryUsage();
    const heapUsed =
      Math.round((processMemoryUsage.heapUsed / 1024 / 1024) * 100) / 100; // MB

    return {
      cpuUsagePercent,
      memoryUsagePercent,
      heapUsed,
    };
  }

  @Cron(CronExpression.EVERY_5_SECONDS, {
    waitForCompletion: true,
  })
  async handleCron() {
    await this.executionCoordinatorService.acceptResults();
    await this.executionCoordinatorService.publishNotifications();
    const { cpuUsagePercent, memoryUsagePercent } = this.getCPUAndMemoryUsage();

    if (cpuUsagePercent > 80 || memoryUsagePercent > 80) {
      this.logger.warn(
        `Skipping execution processing ${cpuUsagePercent.toFixed(2)}% CPU ${memoryUsagePercent.toFixed(2)}% Memory.`,
      );
      return;
    }

    await this.executionCoordinatorService.finalizeReady();
    await this.executionCoordinatorService.publishNotifications();
  }

  @Cron(CronExpression.EVERY_30_SECONDS, {
    waitForCompletion: true,
  })
  async handleStaleRecovery() {
    try {
      const expired = await this.executionAttemptService.expireStaleAttempts();
      if (expired > 0) {
        this.logger.log(`Expired ${expired} stale step attempt(s)`);
      }
      const recovered =
        await this.executionCoordinatorService.recoverStaleFinalizations(
          FINALIZATION_STALE_AFTER_MS,
        );
      if (recovered > 0) {
        this.logger.log(`Recovered ${recovered} stale finalization(s)`);
      }
      const offlined = await this.workerService.markStaleOffline(60);
      if (offlined > 0) {
        this.logger.log(`Marked ${offlined} worker(s) as offline`);
      }
    } catch (error) {
      this.logger.error(`Error during stale recovery: ${error.message}`);
    }
  }
}
