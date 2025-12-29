import { Request, Response, NextFunction } from 'express';
import { getRedis } from '../queue/redis';
import { logger } from '../utils/logger';

/**
 * User-Based Rate Limiter
 * 
 * Since all requests come through ManyChat (same IP), we rate limit
 * by subscriber_id instead of IP address.
 * 
 * This allows:
 * - Per-user limits (e.g., 10 requests per hour per user)
 * - VIP users with higher limits
 * - Blocking specific users
 */

interface UserRateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyPrefix?: string;    // Redis key prefix
}

const DEFAULT_CONFIG: UserRateLimitConfig = {
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 10,            // 10 requests per hour per user
  keyPrefix: 'user_rl:'
};

/**
 * Create a user-based rate limiter middleware
 * Uses subscriber_id from request body
 */
export function createUserRateLimiter(config: Partial<UserRateLimitConfig> = {}) {
  const { windowMs, maxRequests, keyPrefix } = { ...DEFAULT_CONFIG, ...config };
  const windowSeconds = Math.floor(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get subscriber_id from request body
      const subscriberId = req.body?.subscriber_id;

      if (!subscriberId) {
        // If no subscriber_id, fall back to IP-based limiting
        logger.warn('No subscriber_id in request, falling back to IP');
        return next();
      }

      const key = `${keyPrefix}${subscriberId}`;
      const redis = getRedis();

      // Get current count
      const currentCount = await redis.get(key);
      const count = currentCount ? parseInt(currentCount, 10) : 0;

      // Check if over limit
      if (count >= maxRequests) {
        const ttl = await redis.ttl(key);
        const resetTime = new Date(Date.now() + ttl * 1000).toISOString();

        logger.warn(`User rate limit exceeded: ${subscriberId} (${count}/${maxRequests})`);

        return res.status(429).json({
          status: 'error',
          code: 'USER_RATE_LIMIT_EXCEEDED',
          message: `You've used all ${maxRequests} requests for this hour. Try again later!`,
          retryAfter: ttl,
          resetAt: resetTime
        });
      }

      // Increment counter
      if (count === 0) {
        // First request in window - set with expiry
        await redis.setex(key, windowSeconds, '1');
      } else {
        // Increment existing counter
        await redis.incr(key);
      }

      // Add rate limit headers to response
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', (maxRequests - count - 1).toString());
      res.setHeader('X-RateLimit-User', subscriberId);

      next();
    } catch (error) {
      // SECURITY: Fail closed - deny if we can't verify rate limit
      logger.error('User rate limiter error:', error);
      return res.status(503).json({
        status: 'error',
        code: 'SERVICE_UNAVAILABLE',
        message: 'Rate limiting service unavailable. Please try again in a moment.'
      });
    }
  };
}

/**
 * Check remaining requests for a user
 */
export async function getUserRateLimitStatus(subscriberId: string, config: Partial<UserRateLimitConfig> = {}) {
  const { maxRequests, keyPrefix } = { ...DEFAULT_CONFIG, ...config };
  const key = `${keyPrefix}${subscriberId}`;
  const redis = getRedis();

  try {
    const count = await redis.get(key);
    const ttl = await redis.ttl(key);

    return {
      used: count ? parseInt(count, 10) : 0,
      remaining: maxRequests - (count ? parseInt(count, 10) : 0),
      limit: maxRequests,
      resetInSeconds: ttl > 0 ? ttl : 0
    };
  } catch (error) {
    logger.error('Failed to get user rate limit status:', error);
    return null;
  }
}

/**
 * Manually block a specific user
 */
export async function blockUser(subscriberId: string, durationSeconds: number = 86400) {
  const key = `blocked:${subscriberId}`;
  const redis = getRedis();
  await redis.setex(key, durationSeconds, 'true');
  logger.info(`User blocked: ${subscriberId} for ${durationSeconds}s`);
}

/**
 * Check if user is blocked
 */
export async function isUserBlocked(subscriberId: string): Promise<boolean> {
  const key = `blocked:${subscriberId}`;
  const redis = getRedis();
  const blocked = await redis.get(key);
  return blocked === 'true';
}

/**
 * Unblock a user
 */
export async function unblockUser(subscriberId: string) {
  const key = `blocked:${subscriberId}`;
  const redis = getRedis();
  await redis.del(key);
  logger.info(`User unblocked: ${subscriberId}`);
}

/**
 * Middleware to check if user is blocked
 */
export const checkUserBlocked = async (req: Request, res: Response, next: NextFunction) => {
  const subscriberId = req.body?.subscriber_id;

  if (!subscriberId) {
    return next();
  }

  if (await isUserBlocked(subscriberId)) {
    logger.warn(`Blocked user attempted access: ${subscriberId}`);
    return res.status(403).json({
      status: 'error',
      code: 'USER_BLOCKED',
      message: 'Your access has been temporarily suspended.'
    });
  }

  next();
};

/**
 * Pre-configured rate limiter for script generation
 * 10 requests per hour per user
 */
export const userRateLimiter = createUserRateLimiter({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: parseInt(process.env.USER_RATE_LIMIT || '10', 10)
});

/**
 * VIP rate limiter with higher limits
 * 50 requests per hour
 */
export const vipRateLimiter = createUserRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 50,
  keyPrefix: 'vip_rl:'
});
