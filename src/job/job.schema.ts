import * as mongoose from 'mongoose';
import { JobStatus } from './job.interface';

export const JobSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    payload: { type: Object, required: true },
    status: {
      type: String,
      enum: Object.values(JobStatus),
      default: JobStatus.PENDING,
      required: true,
    },
  },
  { timestamps: true },
);
