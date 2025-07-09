import * as mongoose from 'mongoose';
import { JobPriority, JobStatus } from './job.interface';

export const JobSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    payload: { type: Object, required: true },
    priority: {
      type: String,
      enum: Object.values(JobPriority),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(JobStatus),
      default: JobStatus.PENDING,
      required: true,
    },
    result: { type: Object, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

JobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
