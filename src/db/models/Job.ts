import mongoose, { Schema, Document } from 'mongoose';

/**
 * Job Status Enum
 */
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

/**
 * Job Document Interface
 * Tracks BullMQ job status for monitoring and debugging
 */
export interface IJob extends Document {
  jobId: string;
  subscriberId: string;
  status: JobStatus;
  reelUrl: string;
  userIdea: string;
  requestHash: string;
  // Result data
  result?: {
    scriptText?: string;
    imageUrl?: string;
  };
  // Error tracking
  error?: string;
  errorStack?: string;
  attempts: number;
  // Timestamps
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  processingTimeMs?: number;
}

const JobSchema = new Schema<IJob>({
  jobId: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  subscriberId: { 
    type: String, 
    required: true, 
    index: true 
  },
  status: { 
    type: String, 
    enum: ['queued', 'processing', 'completed', 'failed'],
    default: 'queued',
    index: true
  },
  reelUrl: { 
    type: String, 
    required: true 
  },
  userIdea: { 
    type: String, 
    required: true 
  },
  requestHash: { 
    type: String, 
    required: true,
    index: true
  },
  result: {
    scriptText: String,
    imageUrl: String
  },
  error: String,
  errorStack: String,
  attempts: { 
    type: Number, 
    default: 0 
  },
  startedAt: Date,
  completedAt: Date,
  processingTimeMs: Number
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

// Compound index for job queue monitoring
JobSchema.index({ status: 1, createdAt: 1 });

// TTL index - automatically delete completed/failed jobs after 7 days
JobSchema.index({ completedAt: 1 }, { expireAfterSeconds: 604800 });

export const Job = mongoose.model<IJob>('Job', JobSchema);
