import { Redis } from 'ioredis';
import { logger } from '../utils/logger';

/**
 * Redis connection for BullMQ and caching
 * Supports both Upstash (cloud) and local Redis
 * 
 * NOTE: Redis instance is created lazily to ensure env vars are loaded first
 */

let redis: Redis | null = null;

/**
 * Get or create Redis connection
 */
export function getRedis(): Redis {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    logger.info(`Creating Redis connection to: ${redisUrl.substring(0, 30)}...`);

    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ
      retryStrategy: (times: number) => {
        if (times > 20) {
          logger.error('Redis: Max retries reached (20 attempts), giving up');
          return null;
        }
        // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms, max 5000ms
        const delay = Math.min(times * 100 * Math.pow(1.5, times - 1), 5000);
        logger.warn(`Redis: Retrying connection in ${delay}ms (attempt ${times}/20)`);
        return delay;
      },
      enableReadyCheck: true,
      connectTimeout: 15000, // Increased to 15s for Upstash
      // Connection pooling for 50-100 concurrent users
      lazyConnect: false,
      keepAlive: 60000, // Keep alive for 60 seconds (prevent Upstash timeout)
      family: 0, // Auto-detect IPv4/IPv6
      // CRITICAL: Enable offline queue to buffer commands during reconnection
      enableOfflineQueue: true, // Queue commands when disconnected (prevents failures)
      // Upstash-specific optimizations
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          // Reconnect on READONLY errors (Upstash failover)
          logger.warn('Redis: READONLY error detected, reconnecting...');
          return true;
        }
        return false;
      },
      // Connection pool settings for high concurrency
      commandTimeout: 30000, // 30s timeout per command (increased for Upstash latency)
      autoResubscribe: true, // Auto-resubscribe to channels on reconnect
      autoResendUnfulfilledCommands: true, // Resend commands that were sent but not fulfilled
    });

    // Connection event handlers with detailed monitoring
    redis.on('connect', () => {
      logger.info('✅ Redis connecting...');
    });

    redis.on('ready', () => {
      logger.info('✅ Redis connected and ready');
    });

    redis.on('error', (err: Error) => {
      // Don't log ECONNRESET as error (expected during reconnection)
      if (err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT')) {
        logger.warn(`Redis connection issue: ${err.message} (will auto-reconnect)`);
      } else {
        logger.error('Redis error:', err.message);
      }
    });

    redis.on('close', () => {
      logger.warn('Redis connection closed (will auto-reconnect)');
    });

    redis.on('reconnecting', (delay: number) => {
      logger.info(`Redis reconnecting in ${delay}ms...`);
    });

    redis.on('end', () => {
      logger.error('Redis connection ended permanently');
    });
  }

  return redis;
}

/**
 * Initialize Redis connection - wait for ready state
 * Call this at app startup AFTER config is loaded
 */
export async function connectRedis(): Promise<void> {
  const redisInstance = getRedis();

  return new Promise((resolve, reject) => {
    if (redisInstance.status === 'ready') {
      logger.info('✅ Redis already connected');
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error('Redis connection timeout'));
    }, 15000);

    redisInstance.once('ready', () => {
      clearTimeout(timeout);
      logger.info('✅ Redis connection established');
      resolve();
    });

    redisInstance.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Gracefully disconnect Redis
 */
export async function disconnectRedis(): Promise<void> {
  if (!redis) return;

  try {
    await redis.quit();
    redis = null; // Nullify to allow reconnection
    logger.info('Redis disconnected gracefully');
  } catch (error) {
    logger.error('Error disconnecting Redis:', error);
    if (redis) {
      redis.disconnect();
    }
    redis = null; // Nullify even on error
  }
}

/**
 * Check if Redis is connected
 */
export function isRedisConnected(): boolean {
  return redis?.status === 'ready' || false;
}

// Export redis getter that returns the instance (for backwards compatibility)
export { getRedis as redis };
