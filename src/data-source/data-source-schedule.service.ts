import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { DataSourceService } from './data-source.service';
import { DataSourceSyncService } from './data-source-sync.service';

@Injectable()
export class DataSourceScheduleService implements OnModuleInit {
    private readonly logger = new Logger(DataSourceScheduleService.name);

    constructor(
        private readonly schedulerRegistry: SchedulerRegistry,
        private readonly dataSourceService: DataSourceService,
        private readonly syncService: DataSourceSyncService,
    ) {}

    async onModuleInit() {
        await this.loadSchedules();
    }

    private async loadSchedules(): Promise<void> {
        try {
            const sources = await this.dataSourceService.findAllWithSchedule();
            for (const ds of sources) {
                if (ds.syncSchedule && ds.enabled) {
                    this.registerCron(ds.id, ds.syncSchedule);
                }
            }
            this.logger.log(`Loaded ${sources.filter(s => s.syncSchedule && s.enabled).length} scheduled data sources`);
        } catch (err) {
            this.logger.error(`Failed to load schedules: ${err.message}`);
        }
    }

    registerCron(dataSourceId: number, cronExpression: string): void {
        const jobName = `data-source-sync-${dataSourceId}`;

        // Remove existing cron if any
        this.unregisterCron(dataSourceId);

        try {
            const job = new CronJob(cronExpression, async () => {
                this.logger.log(`Cron triggered sync for data source ${dataSourceId}`);
                try {
                    await this.syncService.syncDataSource(dataSourceId);
                } catch (err) {
                    this.logger.error(`Scheduled sync failed for data source ${dataSourceId}: ${err.message}`);
                }
            });

            this.schedulerRegistry.addCronJob(jobName, job);
            job.start();
            this.logger.log(`Registered cron for data source ${dataSourceId}: ${cronExpression}`);
        } catch (err) {
            this.logger.error(`Invalid cron expression for data source ${dataSourceId}: ${cronExpression}`);
        }
    }

    unregisterCron(dataSourceId: number): void {
        const jobName = `data-source-sync-${dataSourceId}`;
        try {
            if (this.schedulerRegistry.doesExist('cron', jobName)) {
                this.schedulerRegistry.deleteCronJob(jobName);
                this.logger.log(`Unregistered cron for data source ${dataSourceId}`);
            }
        } catch {
            // Job doesn't exist, ignore
        }
    }

    updateSchedule(dataSourceId: number, cronExpression: string | null, enabled: boolean): void {
        if (cronExpression && enabled) {
            this.registerCron(dataSourceId, cronExpression);
        } else {
            this.unregisterCron(dataSourceId);
        }
    }
}
