import { Injectable, Inject, Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { Job, JobStatus } from './job.interface';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    @Inject('JOB_MODEL')
    private jobModel: Model<Job>,
  ) { }

  /**
   * Create a new job
   * @param type The type of job
   * @param payload The job payload data
   * @returns The created job
   */
  async create(type: string, payload: object): Promise<Job> {
    const newJob = new this.jobModel({
      type,
      payload,
      status: JobStatus.PENDING,
    });
    return await newJob.save();
  }

  /**
   * Find all jobs
   * @returns Array of jobs
   */
  async findAll(): Promise<Job[]> {
    return this.jobModel.find().exec();
  }

  /**
   * Find a specific job by ID
   * @param id Job ID
   * @returns The found job or null
   */
  async findOne(id: string): Promise<Job> {
    return this.jobModel.findById(id).exec();
  }

  /**
   * Find jobs by status
   * @param status Job status to filter by
   * @returns Array of matching jobs
   */
  async findByStatus(status: JobStatus): Promise<Job[]> {
    return this.jobModel.find({ status }).exec();
  }

  /**
   * Update a job status
   * @param id Job ID
   * @param status New job status
   * @returns The updated job
   */
  async updateStatus(id: string, status: JobStatus): Promise<Job> {
    this.logger.log(`Updating job ${id} status to: ${status}`);
    return this.jobModel
      .findByIdAndUpdate(id, { status }, { new: true })
      .exec();
  }

  /**
   * Mark a job as running
   * @param id Job ID
   * @returns The updated job
   */
  async markAsRunning(id: string): Promise<Job> {
    return this.updateStatus(id, JobStatus.RUNNING);
  }

  /**
   * Mark a job as completed
   * @param id Job ID
   * @returns The updated job
   */
  async markAsCompleted(id: string): Promise<Job> {
    return this.updateStatus(id, JobStatus.COMPLETED);
  }

  /**
   * Mark a job as failed
   * @param id Job ID
   * @returns The updated job
   */
  async markAsFailed(id: string): Promise<Job> {
    return this.updateStatus(id, JobStatus.FAILED);
  }

  /**
   * Delete a job by ID
   * @param id Job ID
   * @returns Result of deletion
   */
  async delete(id: string): Promise<any> {
    return this.jobModel.findByIdAndDelete(id).exec();
  }
}