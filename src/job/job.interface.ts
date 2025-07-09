import { Document } from 'mongoose';

export enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PROCESSED = 'processed',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum JobPriority {
  NORMAL = 'normal',
  HIGH = 'high',
  LOW = 'low',
}

export interface Job extends Document {
  readonly type: string;
  readonly payload: object;
  readonly priority: JobPriority;
  readonly status: JobStatus;
  readonly result?: object;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt?: Date;
}
