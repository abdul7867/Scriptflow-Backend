/**
 * Health Gate Middleware - Layer 2 of Defense-in-Depth
 * 
 * Pre-flight check to reject requests early when system is stressed.
 * This protects the system from overload and prevents crashes.
 * 
 * Checks:
 * - Memory usage (reject if heap > 85%)
 * - Queue depth (reject if > 150 jobs pending)
 * - Redis connectivity
 * - MongoDB connectivity
 * 
 * @see PRD_System_Robustness_t3micro.txt Section 4
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { isRedisConnected, getQueueStats } from '../queue';
import { isMongoConnected } from '../db';
import { config } from '../config';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface HealthGateConfig {
    /** Memory threshold as decimal (0.85 = 85%) */
    memoryThreshold: number;
    /** Max pending jobs before rejecting requests */
    queueDepthThreshold: number;
    /** How often to refresh cached health status (ms) */
    cacheInterval: number;
    /** Grace period after startup before enforcing (ms) */
    gracePeriod: number;
}

export type DegradationLevel = 'normal' | 'warning' | 'critical';

export interface SystemHealth {
    canAcceptRequests: boolean;
    memoryPercent: number;
    queueDepth: number;
    redisHealthy: boolean;
    mongoHealthy: boolean;
    degradationLevel: DegradationLevel;
    rejectReason?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

// Development mode uses higher thresholds (ts-node uses more memory)
const isDevelopment = process.env.NODE_ENV !== 'production';

const DEFAULT_CONFIG: HealthGateConfig = {
    // In development, disable memory-based rejection (set to 1.0 = 100%)
    // ts-node uses ~430MB which would always trigger rejection
    // In production with increased heap (1536MB), use 90% threshold
    memoryThreshold: parseFloat(process.env.HEALTH_GATE_MEMORY_THRESHOLD || (isDevelopment ? '1.0' : '0.90')),
    queueDepthThreshold: parseInt(process.env.HEALTH_GATE_QUEUE_THRESHOLD || '150', 10),
    cacheInterval: 5000,  // Check every 5 seconds
    gracePeriod: 30000,   // 30 seconds after startup
};

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

const startTime = Date.now();
let cachedHealth: SystemHealth | null = null;
let lastHealthCheck = 0;

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate current system health status
 */
export async function getSystemHealth(conf: HealthGateConfig = DEFAULT_CONFIG): Promise<SystemHealth> {
    const now = Date.now();

    // Return cached health if fresh enough
    if (cachedHealth && (now - lastHealthCheck) < conf.cacheInterval) {
        return cachedHealth;
    }

    // Calculate memory usage
    const memUsage = process.memoryUsage();
    const memoryPercent = memUsage.heapUsed / memUsage.heapTotal;

    // Check Redis and Mongo connectivity
    const redisHealthy = isRedisConnected();
    const mongoHealthy = isMongoConnected();

    // Get queue depth
    let queueDepth = 0;
    try {
        const stats = await getQueueStats();
        queueDepth = (stats?.waiting || 0) + (stats?.delayed || 0);
    } catch (err) {
        // Queue stats unavailable - not blocking
        logger.warn('Health gate: Could not get queue stats', { error: (err as Error).message });
    }

    // Determine degradation level
    let degradationLevel: DegradationLevel = 'normal';
    let canAcceptRequests = true;
    let rejectReason: string | undefined;

    // Critical conditions - reject requests
    if (memoryPercent > conf.memoryThreshold) {
        degradationLevel = 'critical';
        canAcceptRequests = false;
        rejectReason = `Memory usage critical (${Math.round(memoryPercent * 100)}%)`;
    } else if (queueDepth > conf.queueDepthThreshold) {
        degradationLevel = 'critical';
        canAcceptRequests = false;
        rejectReason = `Queue depth too high (${queueDepth} jobs)`;
    } else if (!redisHealthy) {
        degradationLevel = 'critical';
        canAcceptRequests = false;
        rejectReason = 'Redis disconnected';
    }
    // Warning conditions - still accept but log
    else if (memoryPercent > 0.70 || queueDepth > 100) {
        degradationLevel = 'warning';
        // MongoDB being down is a warning, not critical (can still process with cache)
    }

    // MongoDB down is a warning level (partial service possible)
    if (!mongoHealthy && degradationLevel === 'normal') {
        degradationLevel = 'warning';
    }

    const health: SystemHealth = {
        canAcceptRequests,
        memoryPercent,
        queueDepth,
        redisHealthy,
        mongoHealthy,
        degradationLevel,
        rejectReason,
    };

    // Cache the result
    cachedHealth = health;
    lastHealthCheck = now;

    return health;
}

/**
 * Check if we're still in the startup grace period
 */
function isInGracePeriod(): boolean {
    return (Date.now() - startTime) < DEFAULT_CONFIG.gracePeriod;
}

// ═══════════════════════════════════════════════════════════════════════════
// BOT SCAN DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List of suspicious paths commonly used by vulnerability scanners and bots.
 * These requests should be dropped immediately to save resources.
 */
const BOT_SCAN_PATTERNS = [
    // PHP exploits
    '.php',
    '.asp',
    '.aspx',
    // WordPress/CMS scans
    '/wp-admin',
    '/wp-login',
    '/wp-content',
    '/wp-includes',
    '/xmlrpc',
    '/wordpress',
    // Common vulnerability scans
    '/admin',
    '/phpmyadmin',
    '/mysql',
    '/cgi-bin',
    '/config',
    '/.env',
    '/.git',
    '/backup',
    '/shell',
    '/cmd',
    // SQL injection probes
    '/union',
    '/select',
    // Other common attack vectors
    '/etc/passwd',
    '/proc/',
    '../',
    '..%2f',
];

/**
 * Check if a path matches bot scan patterns
 */
function isBotScanPath(path: string): boolean {
    const lowerPath = path.toLowerCase();
    return BOT_SCAN_PATTERNS.some(pattern => lowerPath.includes(pattern));
}

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Health Gate Middleware
 * 
 * Rejects requests early when system is under stress to prevent crashes.
 * Also drops bot scans immediately to save memory and processing.
 * Allows health check endpoints and critical webhook endpoints to pass through.
 */
export async function healthGate(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 0: Drop bot scans IMMEDIATELY - before any processing
    // This saves memory and prevents wasting CPU on malicious requests
    // ─────────────────────────────────────────────────────────────────────────
    if (isBotScanPath(req.path)) {
        // Silent drop - don't even log extensively to save resources
        logger.debug('Health gate: Dropped bot scan', { path: req.path.substring(0, 50) });
        res.status(404).end();
        return;
    }

    // Always allow health check endpoints to pass through
    if (req.path.startsWith('/health')) {
        return next();
    }

    // Always allow webhook endpoint to pass through - ManyChat needs a response
    // The webhook service has its own rate limiting and will queue jobs appropriately
    if (req.path === '/api/v3/webhook') {
        return next();
    }

    // Allow during grace period after startup
    if (isInGracePeriod()) {
        return next();
    }

    try {
        const health = await getSystemHealth();

        // Add health info to request for logging downstream
        (req as any).systemHealth = health;

        // Check if system can accept new requests
        if (!health.canAcceptRequests) {
            logger.warn('Health gate rejecting request', {
                path: req.path,
                memory: `${Math.round(health.memoryPercent * 100)}%`,
                queue: health.queueDepth,
                level: health.degradationLevel,
                reason: health.rejectReason,
                requestId: req.requestId,
            });

            res.status(503).json({
                status: 'error',
                code: 'SYSTEM_OVERLOADED',
                message: '🔄 System is busy! Please try again in 1 minute.',
                retryAfter: 60,
                degradationLevel: health.degradationLevel,
            });
            return;
        }

        // Log warning if in warning state
        if (health.degradationLevel === 'warning') {
            logger.info('Health gate: System in warning state', {
                memory: `${Math.round(health.memoryPercent * 100)}%`,
                queue: health.queueDepth,
            });
        }

        next();
    } catch (error) {
        // On error checking health, fail open (allow request)
        logger.error('Health gate check failed, allowing request', { error });
        next();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default healthGate;
