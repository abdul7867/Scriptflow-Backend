import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import hpp from 'hpp';
import mongoSanitize from 'express-mongo-sanitize';
import { getRedis, isRedisConnected } from '../queue/redis';
import { logger } from '../utils/logger';

/**
 * Helmet - Security Headers
 * Protects against XSS, clickjacking, MIME sniffing, and more
 */
export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false, // Needed for some APIs
});

/**
 * Rate Limiter Configuration
 * 
 * Prevents abuse and DDoS:
 * - 100 requests per 15 minutes per IP
 * - Uses Redis for distributed rate limiting (works across multiple instances)
 * - Falls back to memory store if Redis is unavailable
 */
function createRateLimiter() {
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const max = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);

  const baseConfig = {
    windowMs,
    max,
    message: {
      status: 'error',
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again in 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req: Request) => {
      // Skip rate limiting for health checks
      return req.path === '/health';
    },
    handler: (req: Request, res: Response) => {
      logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
      res.status(429).json({
        status: 'error',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again in 15 minutes.'
      });
    }
  };

  // Use Redis store if connected, otherwise use memory
  // NOTE: Redis connection is checked at middleware execution time, not module load
  if (isRedisConnected()) {
    logger.info('Rate limiter using Redis store');
    return rateLimit({
      ...baseConfig,
      store: new RedisStore({
        // @ts-expect-error - Type compatibility between ioredis and rate-limit-redis
        sendCommand: async (command: string, ...args: string[]) => getRedis().call(command, ...args),
        prefix: 'rl:' // Rate limit prefix
      })
    });
  }

  logger.warn('Rate limiter using memory store (Redis not connected at startup - will fallback to IP-based limiting)');
  return rateLimit(baseConfig);
}

// Rate limiter is created lazily to give Redis time to connect
// In production, Redis should connect before first request
let _rateLimiter: ReturnType<typeof rateLimit> | null = null;
let _lastRedisState: boolean = false; // Track Redis state to detect reconnections

// Create the rate limiter instance outside of request handler
// to avoid express-rate-limit validation warning
export function initRateLimiter(): void {
  if (!_rateLimiter) {
    _rateLimiter = createRateLimiter();
    _lastRedisState = isRedisConnected();
  }
}

/**
 * Rate limiter middleware with automatic Redis reconnection handling
 * 
 * PRODUCTION FIX: If Redis was disconnected and reconnects, we recreate
 * the rate limiter to use Redis store again. This prevents rate limit
 * bypass after Redis reconnection.
 */
export const rateLimiter = (req: any, res: any, next: any) => {
  const currentRedisState = isRedisConnected();

  // Detect Redis reconnection - recreate limiter to use Redis store
  if (currentRedisState && !_lastRedisState) {
    logger.info('Rate limiter: Redis reconnected, recreating with Redis store');
    _rateLimiter = createRateLimiter();
  }
  _lastRedisState = currentRedisState;

  // If not initialized yet, create it (fallback)
  if (!_rateLimiter) {
    _rateLimiter = createRateLimiter();
  }
  return _rateLimiter(req, res, next);
};

/**
 * Stricter rate limiter for sensitive endpoints
 * 10 requests per 15 minutes
 */
export const strictRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    status: 'error',
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests to this endpoint.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * HPP - HTTP Parameter Pollution Protection
 * Prevents attacks via duplicate query parameters
 */
export const hppMiddleware = hpp();

/**
 * MongoDB Sanitization
 * Prevents NoSQL injection attacks by removing $ and . from user input
 */
export const mongoSanitizeMiddleware = mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    logger.warn(`Sanitized key '${key}' in request from ${req.ip}`);
  }
});

/**
 * API Key Authentication Middleware
 * For protected admin endpoints
 * 
 * SECURITY: Defaults to DENY access unless:
 * 1. Valid ADMIN_API_KEY is configured and matches, OR
 * 2. Explicitly in development mode (NODE_ENV === 'development')
 */
export const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string;
  const validApiKey = process.env.ADMIN_API_KEY;
  const nodeEnv = process.env.NODE_ENV || 'production'; // Default to production for security

  // SECURITY: If no API key configured
  if (!validApiKey || validApiKey.trim() === '') {
    // ONLY allow bypass in explicit development mode
    if (nodeEnv === 'development') {
      logger.warn('⚠️ Admin endpoint accessed without API key (DEVELOPMENT MODE ONLY)');
      return next();
    }

    // In production or any other mode, deny access
    logger.error('CRITICAL: ADMIN_API_KEY not configured! Denying admin endpoint access.');
    return res.status(500).json({
      status: 'error',
      code: 'CONFIG_ERROR',
      message: 'Server configuration error'
    });
  }

  // Validate provided API key
  if (!apiKey || apiKey !== validApiKey) {
    logger.warn(`Unauthorized API access attempt from ${req.ip}`, {
      path: req.path,
      hasKey: !!apiKey,
      fingerprint: (req as any).fingerprint
    });
    return res.status(401).json({
      status: 'error',
      code: 'UNAUTHORIZED',
      message: 'Invalid or missing API key'
    });
  }

  next();
};

/**
 * Request Fingerprinting Middleware
 * Adds unique fingerprint for tracking suspicious activity
 */
export const requestFingerprint = (req: Request, res: Response, next: NextFunction) => {
  const fingerprint = [
    req.ip,
    req.headers['user-agent'] || 'unknown',
    req.headers['accept-language'] || 'unknown'
  ].join('|');

  // Hash the fingerprint
  const crypto = require('crypto');
  (req as any).fingerprint = crypto.createHash('sha256').update(fingerprint).digest('hex').substring(0, 16);

  next();
};

/**
 * Request Size Limiter
 * Prevents large payload attacks
 */
export const bodySizeLimit = (limit: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    const maxSize = parseSize(limit);

    if (contentLength > maxSize) {
      logger.warn(`Request body too large: ${contentLength} bytes from ${req.ip}`);
      return res.status(413).json({
        status: 'error',
        code: 'PAYLOAD_TOO_LARGE',
        message: `Request body exceeds maximum size of ${limit}`
      });
    }

    next();
  };
};

function parseSize(size: string): number {
  const units: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024
  };

  const match = size.toLowerCase().match(/^(\d+)(b|kb|mb|gb)?$/);
  if (!match) return 1024 * 1024; // Default 1MB

  const value = parseInt(match[1], 10);
  const unit = match[2] || 'b';

  return value * units[unit];
}

/**
 * Security logging middleware
 * Logs suspicious patterns
 */
export const securityLogger = (req: Request, res: Response, next: NextFunction) => {
  // Log if request contains suspicious patterns
  const suspicious = [
    req.url.includes('..'),
    req.url.includes('<script'),
    req.url.includes('javascript:'),
    Object.values(req.body || {}).some(v =>
      typeof v === 'string' && (v.includes('<script') || v.includes('javascript:'))
    )
  ];

  if (suspicious.some(Boolean)) {
    logger.warn(`Suspicious request from ${req.ip}: ${req.method} ${req.url}`);
  }

  next();
};
