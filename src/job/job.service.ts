import { Injectable, Logger } from '@nestjs/common';
import { JobStatus } from './job-status.enum';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { JobEntity } from './job.entity';
import { JobPriority } from './job-priority.enum';
import { FeatureFlagService } from '../common/feature-flags.service';

// Map job types to feature flags
const JOB_FEATURE_MAP: Record<string, string> = {
  'ingest-content': 'rag',
  'search': 'rag',
  'ask': 'rag',
  'embedding': 'rag',
  'entity-extraction': 'entities',
  'date-extraction': 'timelines',
  'image-generate': 'canvas',
  'image-edit': 'canvas',
  'data-source-sync': 'data_sources',
};

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    @InjectRepository(JobEntity)
    private readonly repo: Repository<JobEntity>,
    private readonly featureFlagService: FeatureFlagService,
  ) { }

  async create(type: string, priority: JobPriority, payload: object) {
    // Skip job creation if the associated feature is disabled
    const featureKey = JOB_FEATURE_MAP[type];
    if (featureKey && !this.featureFlagService.isEnabled(featureKey as any)) {
      this.logger.log(`Skipping job '${type}' — feature '${featureKey}' is disabled`);
      return null;
    }

    const job = this.repo.create({
      type,
      priority,
      payload,
      status: JobStatus.PENDING,
    });
    return this.repo.save(job);
  }

  async findAll() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: number) {
    return this.repo.findOneBy({ id });
  }

  async findByStatus(status: JobStatus) {
    return this.repo.find({
      where: { status: status as any },
      order: { createdAt: 'ASC' },
    });
  }

  async updateStatus(id: number, status: JobStatus) {
    this.logger.log(`Updating job ${id} status to: ${status}`);

    const job = await this.repo.findOneBy({ id });
    if (!job) return null;
    job.status = status;
    if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
      job.expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    }
    return this.repo.save(job);
  }

  async markAsRunning(id: number) {
    return this.updateStatus(id, JobStatus.RUNNING);
  }

  async markAsCompleted(id: number) {
    return this.updateStatus(id, JobStatus.COMPLETED);
  }

  async markAsFailed(id: number) {
    return this.updateStatus(id, JobStatus.FAILED);
  }

  async createAndWaitForResult(type: string, priority: JobPriority, payload: object, timeoutMs: number = 10000): Promise<any | null> {
    const job = await this.create(type, priority, payload);
    const pollInterval = 200;
    const maxAttempts = Math.ceil(timeoutMs / pollInterval);

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      const current = await this.repo.findOneBy({ id: job.id });
      if (!current) return null;
      if (current.status === JobStatus.COMPLETED || current.status === JobStatus.PROCESSED) {
        await this.repo.delete({ id: job.id });
        return current.result;
      }
      if (current.status === JobStatus.FAILED) {
        await this.repo.delete({ id: job.id });
        return null;
      }
    }

    this.logger.warn(`Job ${job.id} timed out after ${timeoutMs}ms`);
    await this.repo.delete({ id: job.id });
    return null;
  }

  async delete(id: number) {
    const job = await this.repo.findOneBy({ id });
    if (!job) return null;
    await this.repo.remove(job);
    return job;
  }

  async requeueStaleJobs(heartbeatThresholdDate: Date, maxRetries: number = 3): Promise<number> {
    // Find jobs in 'processing' whose worker has a stale heartbeat
    const staleJobs = await this.repo
      .createQueryBuilder('job')
      .innerJoin('workers', 'w', 'w.id = job.claimed_by')
      .where('job.status = :status', { status: 'processing' })
      .andWhere('w.last_heartbeat < :threshold', { threshold: heartbeatThresholdDate })
      .getMany();

    if (staleJobs.length === 0) return 0;

    let requeued = 0;
    for (const job of staleJobs) {
      if (job.retryCount >= maxRetries) {
        job.status = JobStatus.FAILED;
        this.logger.warn(`Job ${job.id} exceeded max retries (${maxRetries}), marking as failed`);
      } else {
        job.status = JobStatus.PENDING;
        job.claimedBy = null;
        job.startedAt = null;
        this.logger.warn(`Requeuing stale job ${job.id} (retry ${job.retryCount + 1}/${maxRetries})`);
      }
      job.retryCount += 1;
      requeued++;
    }

    await this.repo.save(staleJobs);
    return requeued;
  }

  async deleteExpiredJobs() {
    const now = new Date();
    const expiredJobs = await this.repo
      .createQueryBuilder('job')
      .where('job.expires_at IS NOT NULL')
      .andWhere('job.expires_at <= :now', { now })
      .getMany();

    if (expiredJobs.length > 0) {
      await this.repo.remove(expiredJobs);
    }

    return expiredJobs.length;
  }
}
