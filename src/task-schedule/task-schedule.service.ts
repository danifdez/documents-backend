import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as os from 'os';
import * as process from 'process';
import { JobStatus } from 'src/job/job-status.enum';
import { JobService } from 'src/job/job.service';
import { JobProcessorFactory } from 'src/job-processor/job-processor.factory';

@Injectable()
export class TaskScheduleService {
  private readonly logger = new Logger(TaskScheduleService.name);

  constructor(
    private readonly jobService: JobService,
    private readonly jobProcessorFactory: JobProcessorFactory,
  ) { }

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
    const { cpuUsagePercent, memoryUsagePercent } = this.getCPUAndMemoryUsage();

    if (cpuUsagePercent > 80 || memoryUsagePercent > 80) {
      this.logger.warn(
        `Skipping job processing ${cpuUsagePercent.toFixed(2)}% CPU ${memoryUsagePercent.toFixed(2)}% Memory.`,
      );
      return;
    }

    const pendingJobs = await this.jobService.findByStatus(JobStatus.PROCESSED);

    const firstJob = pendingJobs[0];
    if (
      !firstJob ||
      !firstJob.payload ||
      typeof firstJob.payload !== 'object'
    ) {
      return;
    }

    try {
      const processor = this.jobProcessorFactory.getProcessor(firstJob.type);

      if (!processor) {
        this.logger.error(`No processor found for job type: ${firstJob.type}`);
        await this.jobService.markAsFailed((firstJob as any).id?.toString?.() || String((firstJob as any).id));
        return;
      }

      this.logger.log(`Processing job ${firstJob.id} of type ${firstJob.type}`);
      await processor.process(firstJob);

      await this.jobService.markAsCompleted((firstJob as any).id?.toString?.() || String((firstJob as any).id));

    } catch (error) {
      this.logger.error(
        `Error processing job ${firstJob.id}: ${error.message}`,
      );
      await this.jobService.markAsFailed((firstJob as any).id?.toString?.() || String((firstJob as any).id));
    }
  }

  @Cron(CronExpression.EVERY_HOUR, {
    waitForCompletion: true,
  })
  async cleanupExpiredJobs() {
    this.logger.log('Running cleanup task for expired jobs...');
    try {
      const deletedCount = await this.jobService.deleteExpiredJobs();
      if (deletedCount > 0) {
        this.logger.log(`Cleanup completed: ${deletedCount} expired job(s) deleted`);
      } else {
        this.logger.log('Cleanup completed: No expired jobs found');
      }
    } catch (error) {
      this.logger.error(`Error during cleanup of expired jobs: ${error.message}`);
    }
  }
}
