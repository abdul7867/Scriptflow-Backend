/**
 * BullMQ Queue Management for Script Generation
 * 
 * Enhancements for System Robustness (PRD Section 8):
 * - Queue backpressure management (reject if depth > 200)
 * - Removed QueueEvents (12% Redis reduction per Performance PRD)
 * - Queue depth monitoring
 * 
 * Worker events provide logging (QueueEvents removed per PRD)
 */

import { Queue } from 'bullmq';
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

  // Copy mode: output transcript as-is formatted as script
  isCopyMode?: boolean;
}

/**
 * Job data interface for copy/download operations
 */
export interface CopyJobData {
  requestId: string;
  subscriberId: string;
  reelUrl: string;
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

/**
 * Copy job result interface
 */
export interface CopyJobResult {
  success: boolean;
  videoUrl?: string;
  reelHash?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export const QUEUE_NAME = 'script-generation';

/**
 * Queue backpressure configuration
 * @see PRD_System_Robustness_t3micro.txt Section 8
 */
const QUEUE_CONFIG = {
  /** Maximum jobs allowed in queue before rejecting new requests */
  maxQueueDepth: parseInt(process.env.QUEUE_MAX_DEPTH || '200', 10),
  /** Warning threshold for queue depth */
  warningQueueDepth: parseInt(process.env.QUEUE_WARNING_DEPTH || '150', 10),
  /** Redis key for backpressure flag */
  backpressureKey: 'queue:backpressure',
  /** How often to check queue depth (ms) */
  checkInterval: parseInt(process.env.QUEUE_CHECK_INTERVAL || '10000', 10),
};

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

// Lazy-initialized queue instance
let scriptQueue: Queue<ScriptJobData, ScriptJobResult> | null = null;

// Queue monitoring interval
let queueMonitorInterval: NodeJS.Timeout | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize the queue (call after Redis is connected)
 * 
 * NOTE: QueueEvents removed per Performance PRD Section 2.2.5
 * Worker events (worker.on('completed'), etc.) provide equivalent logging
 */
export function initializeQueue(): Queue<ScriptJobData, ScriptJobResult> {
  if (scriptQueue) {
    logger.info('Queue already initialized, reusing existing instance');
    return scriptQueue;
  }

  // Get single Redis connection to share across all BullMQ components
  const connection = getRedis();

  scriptQueue = new Queue<ScriptJobData, ScriptJobResult>(QUEUE_NAME, {
    connection, // Reuse same connection
    defaultJobOptions: {
      attempts: 2, // Reduced from 3 - circuit breaker handles failure protection
      backoff: {
        type: 'exponential',
        delay: 3000 // Increased from 2000 to give more breathing room
      },
      removeOnComplete: {
        count: 100
      },
      removeOnFail: {
        count: 50
      }
    }
  });

  // QueueEvents REMOVED per PRD - saves 12% Redis commands
  // Worker events provide equivalent logging functionality

  logger.info('✅ BullMQ queue initialized (QueueEvents disabled for performance)');
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

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE BACKPRESSURE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start queue depth monitoring for backpressure management
 * @see PRD_System_Robustness_t3micro.txt Section 8.2
 */
export function startQueueMonitoring(): void {
  if (queueMonitorInterval) {
    logger.warn('Queue monitoring already running');
    return;
  }

  queueMonitorInterval = setInterval(async () => {
    try {
      const stats = await getQueueStats();
      const totalPending = (stats?.waiting || 0) + (stats?.delayed || 0);

      const redis = getRedis();

      if (totalPending > QUEUE_CONFIG.maxQueueDepth) {
        // Enable backpressure - reject new requests
        await redis.set(QUEUE_CONFIG.backpressureKey, '1', 'EX', 60);
        logger.warn(`Queue backpressure ENABLED: ${totalPending} pending jobs (max: ${QUEUE_CONFIG.maxQueueDepth})`);
      } else if (totalPending < QUEUE_CONFIG.warningQueueDepth) {
        // Disable backpressure
        await redis.del(QUEUE_CONFIG.backpressureKey);
      }

      // Log warning when approaching limit
      if (totalPending > QUEUE_CONFIG.warningQueueDepth && totalPending <= QUEUE_CONFIG.maxQueueDepth) {
        logger.info(`Queue depth warning: ${totalPending} pending jobs (warning: ${QUEUE_CONFIG.warningQueueDepth})`);
      }
    } catch (err) {
      logger.error('Queue monitoring error:', err);
    }
  }, QUEUE_CONFIG.checkInterval);

  logger.info('✅ Queue monitoring started', {
    maxDepth: QUEUE_CONFIG.maxQueueDepth,
    warningDepth: QUEUE_CONFIG.warningQueueDepth,
    checkInterval: `${QUEUE_CONFIG.checkInterval}ms`,
  });
}

/**
 * Stop queue monitoring
 */
export function stopQueueMonitoring(): void {
  if (queueMonitorInterval) {
    clearInterval(queueMonitorInterval);
    queueMonitorInterval = null;
    logger.info('Queue monitoring stopped');
  }
}

/**
 * Check if queue can accept new jobs (backpressure check)
 * Returns true if queue can accept jobs, false if backpressure is active
 * 
 * @see PRD_System_Robustness_t3micro.txt Section 8.2
 */
export async function canAcceptJob(): Promise<boolean> {
  try {
    const redis = getRedis();
    const backpressure = await redis.get(QUEUE_CONFIG.backpressureKey);
    return backpressure !== '1';
  } catch (err) {
    // Fail open - allow job on Redis error (safer than rejecting)
    logger.warn('Backpressure check failed, allowing job:', err);
    return true;
  }
}

/**
 * Get current queue depth (waiting + delayed)
 */
export async function getQueueDepth(): Promise<number> {
  try {
    const stats = await getQueueStats();
    return (stats?.waiting || 0) + (stats?.delayed || 0);
  } catch {
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// JOB MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

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
 * Add a copy/download job to the queue
 */
export async function addCopyJob(data: CopyJobData): Promise<string> {
  const queue = getQueue() as Queue<any, any>;
  const job = await queue.add('copy', data, {
    jobId: data.requestId,
  });

  logger.info(`Copy job ${job.id} added to queue for user ${data.subscriberId}`);
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

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Close queue connections
 */
export async function closeQueue(): Promise<void> {
  try {
    // Stop monitoring first
    stopQueueMonitoring();

    if (scriptQueue) {
      await scriptQueue.close();
      scriptQueue = null; // Clear reference to prevent reuse
      logger.info('Queue closed');
    }
    logger.info('BullMQ queue closed successfully');
  } catch (error) {
    logger.error('Error closing queue:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { scriptQueue, QUEUE_CONFIG };
