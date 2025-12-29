import { Request, Response } from 'express';
import { isMongoConnected } from '../db';
import { isRedisConnected, getQueueStats } from '../queue';
import { logger } from '../utils/logger';

/**
 * Basic health check - fast, for load balancers
 */
export const healthHandler = (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
};

/**
 * Detailed health check - includes dependency status
 * Useful for debugging and monitoring dashboards
 */
export const detailedHealthHandler = async (req: Request, res: Response) => {
  try {
    const mongoStatus = isMongoConnected() ? 'connected' : 'disconnected';
    const redisStatus = isRedisConnected() ? 'connected' : 'disconnected';
    
    let queueStats = null;
    try {
      queueStats = await getQueueStats();
    } catch (err) {
      logger.warn('Could not fetch queue stats:', err);
    }

    const healthy = mongoStatus === 'connected' && redisStatus === 'connected';

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        mongodb: mongoStatus,
        redis: redisStatus
      },
      queue: queueStats,
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
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
