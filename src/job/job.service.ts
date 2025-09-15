import { Injectable, Logger } from '@nestjs/common';
import { JobStatus } from './job-status.enum';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { JobEntity } from './job.entity';
import { JobPriority } from './job-priority.enum';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    @InjectRepository(JobEntity)
    private readonly repo: Repository<JobEntity>,
  ) {}

  async create(type: string, priority: JobPriority, payload: object) {
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

  async delete(id: number) {
    const job = await this.repo.findOneBy({ id });
    if (!job) return null;
    await this.repo.remove(job);
    return job;
  }
}
