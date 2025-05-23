import { Document } from 'mongoose';

export enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface Job extends Document {
  readonly type: string;
  readonly payload: object;
  readonly status: JobStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
