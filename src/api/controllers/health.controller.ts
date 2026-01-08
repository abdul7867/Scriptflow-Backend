/**
 * Health Controller - Enhanced with System Robustness metrics
 * 
 * Provides health check endpoints with:
 * - Memory usage and thresholds
 * - Queue depth and health
 * - Degradation state
 * - Alert flags for monitoring
 * 
 * @see PRD_System_Robustness_t3micro.txt Section 10.1
 */

import { Request, Response } from 'express';
import { isMongoConnected } from '../../db';
import { isRedisConnected, getQueueStats } from '../../queue';
import { logger } from '../../utils/logger';
import { degradationService } from '../../services/degradation.service';
import { memoryGovernor } from '../../utils/memoryGovernor';
import { getAllCircuitStats, areCircuitsHealthy } from '../../utils/circuitBreaker';

// ═══════════════════════════════════════════════════════════════════════════
// BASIC HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Basic health check - fast, for load balancers
 */
export const healthHandler = (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
};

// ═══════════════════════════════════════════════════════════════════════════
// DETAILED HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detailed health check - includes dependency status and system robustness metrics
 * Useful for debugging and monitoring dashboards
 * 
 * Enhanced with:
 * - Memory percentage and thresholds
 * - Queue depth monitoring
 * - Degradation state tracking
 * - Alert flags for monitoring
 */
export const detailedHealthHandler = async (req: Request, res: Response) => {
  try {
    // Service connectivity checks
    const mongoStatus = isMongoConnected() ? 'connected' : 'disconnected';
    const redisStatus = isRedisConnected() ? 'connected' : 'disconnected';

    // Queue statistics
    let queueStats = null;
    try {
      queueStats = await getQueueStats();
    } catch (err) {
      logger.warn('Could not fetch queue stats:', err);
    }

    // Memory health check
    const memUsage = process.memoryUsage();
    const memoryPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    const isMemoryHealthy = memoryPercent < 85;

    // Queue health check
    const queueDepth = (queueStats?.waiting || 0) + (queueStats?.delayed || 0);
    const isQueueHealthy = queueDepth < 150;

    // Memory Governor status
    const memoryGovernorStats = memoryGovernor.getStats();

    // Degradation state
    const degradation = degradationService.getState();

    // Circuit breaker states
    const circuitStats = getAllCircuitStats();
    const circuitsHealthy = areCircuitsHealthy();

    // Overall health determination
    const healthy = mongoStatus === 'connected'
      && redisStatus === 'connected'
      && isMemoryHealthy
      && isQueueHealthy
      && circuitsHealthy;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),

      // Service connectivity
      services: {
        mongodb: mongoStatus,
        redis: redisStatus
      },

      // Queue status
      queue: {
        ...queueStats,
        depth: queueDepth,
        healthy: isQueueHealthy,
        maxDepth: 200,
        warningDepth: 150
      },

      // Memory status
      memory: {
        used: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`,
        total: `${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
        percent: `${Math.round(memoryPercent)}%`,
        healthy: isMemoryHealthy,
        level: memoryGovernorStats.level,
        rss: `${memoryGovernorStats.rssMB} MB`
      },

      // Circuit breakers
      circuits: {
        healthy: circuitsHealthy,
        states: circuitStats
      },

      // Degradation state
      degradation,

      // System info
      uptime: process.uptime(),
      nodeVersion: process.version,

      // Alert flags for external monitoring tools
      alerts: {
        memoryWarning: memoryPercent > 70,
        memoryCritical: memoryPercent > 85,
        queueWarning: queueDepth > 100,
        queueCritical: queueDepth > 150,
        servicesDown: mongoStatus !== 'connected' || redisStatus !== 'connected',
        circuitOpen: !circuitsHealthy
      }
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'error',
      message: 'Health check failed'
    });
  }
};
