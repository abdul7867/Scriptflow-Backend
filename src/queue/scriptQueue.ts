import { Queue, QueueEvents } from 'bullmq';
import { getRedis } from './redis';
import { logger } from '../utils/logger';

/**
 * Job data interface for script generation
 */
export interface ScriptJobData {
  requestId: string;
  requestHash: string;
  subscriberId: string;
  reelUrl: string;
  userIdea: string;
  
  // NEW: Optional hint parameters
  toneHint?: 'professional' | 'funny' | 'provocative' | 'educational' | 'casual';
  languageHint?: string;
  mode?: 'full' | 'hook_only';
}

/**
 * Job result interface
 */
export interface ScriptJobResult {
  success: boolean;
  scriptText?: string;
  imageUrl?: string;
  error?: string;
}

// Queue name
const QUEUE_NAME = 'script-generation';

// Lazy-initialized queue instances
let scriptQueue: Queue<ScriptJobData, ScriptJobResult> | null = null;
let queueEvents: QueueEvents | null = null;

/**
 * Initialize the queue (call after Redis is connected)
 */
export function initializeQueue(): Queue<ScriptJobData, ScriptJobResult> {
  if (scriptQueue) {
    return scriptQueue;
  }

  scriptQueue = new Queue<ScriptJobData, ScriptJobResult>(QUEUE_NAME, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: {
        count: 100
      },
      removeOnFail: {
        count: 50
      }
    }
  });

  // Initialize queue events for logging
  queueEvents = new QueueEvents(QUEUE_NAME, { connection: getRedis() });

  queueEvents.on('completed', ({ jobId }) => {
    logger.info(`Job ${jobId} completed`);
  });

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error(`Job ${jobId} failed: ${failedReason}`);
  });

  queueEvents.on('stalled', ({ jobId }) => {
    logger.warn(`Job ${jobId} stalled, will be retried`);
  });

  logger.info('✅ BullMQ queue initialized');
  return scriptQueue;
}

/**
 * Get the queue instance (initializes if needed)
 */
export function getQueue(): Queue<ScriptJobData, ScriptJobResult> {
  if (!scriptQueue) {
    return initializeQueue();
  }
  return scriptQueue;
}

/**
 * Add a script generation job to the queue
 */
export async function addScriptJob(data: ScriptJobData): Promise<string> {
  const queue = getQueue();
  const job = await queue.add('generate', data, {
    jobId: data.requestId,
  });
  
  logger.info(`Job ${job.id} added to queue for user ${data.subscriberId}`);
  return job.id!;
}

/**
 * Get queue statistics for health endpoint
 */
export async function getQueueStats() {
  const queue = getQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount()
  ]);

  return { waiting, active, completed, failed, delayed };
}

/**
 * Close queue connections
 */
export async function closeQueue(): Promise<void> {
  if (queueEvents) {
    await queueEvents.close();
  }
  if (scriptQueue) {
    await scriptQueue.close();
  }
  logger.info('BullMQ queue closed');
}

export { QUEUE_NAME, scriptQueue };
