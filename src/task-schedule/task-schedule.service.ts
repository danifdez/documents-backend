import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as os from 'os';
import * as process from 'process';
import { ExecutionService } from 'src/execution/execution.service';
import { ExecutionStatus } from 'src/execution/execution-status.enum';
import { ExecutionProcessorFactory } from 'src/execution-processor/execution-processor.factory';
import { WorkerService } from 'src/worker/worker.service';
import { ExecutionAttemptService } from 'src/execution/execution-attempt.service';

@Injectable()
export class TaskScheduleService {
  private readonly logger = new Logger(TaskScheduleService.name);

  constructor(
    private readonly executionService: ExecutionService,
    private readonly executionProcessorFactory: ExecutionProcessorFactory,
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
    await this.executionAttemptService.processReceivedResults();
    const { cpuUsagePercent, memoryUsagePercent } = this.getCPUAndMemoryUsage();

    if (cpuUsagePercent > 80 || memoryUsagePercent > 80) {
      this.logger.warn(
        `Skipping execution processing ${cpuUsagePercent.toFixed(2)}% CPU ${memoryUsagePercent.toFixed(2)}% Memory.`,
      );
      return;
    }

    const pendingExecutions =
      await this.executionService.findReadyForFinalization();

    const firstExecution = pendingExecutions[0];
    if (
      !firstExecution ||
      !firstExecution.payload ||
      typeof firstExecution.payload !== 'object'
    ) {
      return;
    }

    try {
      const processor = this.executionProcessorFactory.getProcessor(
        firstExecution.taskType,
      );

      if (!processor) {
        await this.executionService.markAsCompleted(firstExecution.executionId);
        return;
      }

      this.logger.log(
        `Processing execution ${firstExecution.executionId} of type ${firstExecution.taskType}`,
      );
      await processor.process(firstExecution);

      const current = await this.executionService.findOne(
        firstExecution.executionId,
      );
      if (
        current &&
        ![
          ExecutionStatus.COMPLETED,
          ExecutionStatus.FAILED,
          ExecutionStatus.CANCELLED,
        ].includes(current.status)
      ) {
        await this.executionService.markAsCompleted(firstExecution.executionId);
      }
    } catch (error) {
      this.logger.error(
        `Error processing execution ${firstExecution.executionId}: ${error.message}`,
      );
      await this.executionService.markAsFailed(
        firstExecution.executionId,
        error.message,
      );
    }
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
      const offlined = await this.workerService.markStaleOffline(60);
      if (offlined > 0) {
        this.logger.log(`Marked ${offlined} worker(s) as offline`);
      }
    } catch (error) {
      this.logger.error(`Error during stale recovery: ${error.message}`);
    }
  }
}
