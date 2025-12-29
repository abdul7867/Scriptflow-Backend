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
        if (times > 10) {
          logger.error('Redis: Max retries reached, giving up');
          return null;
        }
        const delay = Math.min(times * 100, 3000);
        logger.warn(`Redis: Retrying connection in ${delay}ms (attempt ${times})`);
        return delay;
      },
      enableReadyCheck: true,
      connectTimeout: 10000
    });

    // Connection event handlers
    redis.on('connect', () => {
      logger.info('✅ Redis connecting...');
    });

    redis.on('ready', () => {
      logger.info('✅ Redis connected and ready');
    });

    redis.on('error', (err: Error) => {
      logger.error('Redis error:', err.message);
    });

    redis.on('close', () => {
      logger.warn('Redis connection closed');
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
    logger.info('Redis disconnected gracefully');
  } catch (error) {
    logger.error('Error disconnecting Redis:', error);
    redis.disconnect();
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
