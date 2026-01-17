import { createServer } from './server';
import { connectDB, disconnectDB } from './db';
import { connectRedis, disconnectRedis, closeQueue, startWorker, stopWorker, initializeQueue, startQueueMonitoring, stopQueueMonitoring } from './queue';
import { initRateLimiter } from './middleware';
import { logger } from './utils/logger';
import { config } from './config';
import { memoryGovernor } from './utils/memoryGovernor';
import { startPeriodicCleanup, stopPeriodicCleanup, forceCleanupTempDir } from './services/cleanup.service';
import fs from 'fs';
import path from 'path';

// Ensure temp directory exists
const tempDir = path.join(process.cwd(), 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// Initialize Instagram cookies from environment variable (for Docker deployments)
const COOKIES_PATH = path.resolve(config.INSTAGRAM_COOKIES_PATH);
logger.info(`Instagram cookies path: ${COOKIES_PATH}`);

if (process.env.INSTAGRAM_COOKIES) {
  try {
    // Ensure cookies directory exists
    const cookiesDir = path.dirname(COOKIES_PATH);
    if (!fs.existsSync(cookiesDir)) {
      fs.mkdirSync(cookiesDir, { recursive: true });
      logger.info(`Created cookies directory: ${cookiesDir}`);
    }
    fs.writeFileSync(COOKIES_PATH, process.env.INSTAGRAM_COOKIES, 'utf-8');
    logger.info('✅ Successfully initialized cookies from ENV');
    logger.info(`✅ Instagram cookies written to: ${COOKIES_PATH}`);
  } catch (err: any) {
    logger.error(`❌ Failed to write Instagram cookies: ${err.message}`);
  }
} else {
  // Check if cookies file exists at configured path
  if (fs.existsSync(COOKIES_PATH)) {
    const stats = fs.statSync(COOKIES_PATH);
    logger.info(`✅ Instagram cookies found (${stats.size} bytes) at: ${COOKIES_PATH}`);
  } else {
    logger.warn(`⚠️  Instagram cookies file not found at: ${COOKIES_PATH}`);
    logger.warn('⚠️  Instagram downloads may fail without cookies. Private/age-restricted reels will be unavailable.');
    logger.warn(`⚠️  To fix: Place instagram_cookies.txt in ${path.dirname(COOKIES_PATH)}`);
  }
}

/**
 * Application Bootstrap
 * Initializes all services in order and handles graceful shutdown
 * 
 * Enhanced with System Robustness features:
 * - Memory Governor (real-time memory monitoring)
 * - Queue Monitoring (backpressure management)
 * 
 * @see PRD_System_Robustness_t3micro.txt
 */
async function bootstrap() {
  try {
    // ═══════════════════════════════════════════════════════════════════════
    // PRODUCTION CONFIGURATION VALIDATION
    // Warn about missing critical configuration at startup
    // ═══════════════════════════════════════════════════════════════════════
    if (config.NODE_ENV === 'production') {
      const warnings: string[] = [];

      if (!process.env.ADMIN_API_KEY || process.env.ADMIN_API_KEY.trim() === '') {
        warnings.push('⚠️  ADMIN_API_KEY not set - admin endpoints will be inaccessible');
      }

      if (!config.BASE_URL || config.BASE_URL.trim() === '') {
        warnings.push('⚠️  BASE_URL not set - script sharing URLs will not work');
      }

      if (!config.MANYCHAT_API_KEY || config.MANYCHAT_API_KEY.trim() === '') {
        warnings.push('⚠️  MANYCHAT_API_KEY not set - ManyChat integration will fail');
      }

      if (warnings.length > 0) {
        logger.warn('═══ PRODUCTION CONFIGURATION WARNINGS ═══');
        warnings.forEach(w => logger.warn(w));
        logger.warn('═══════════════════════════════════════════');
      }
    }

    // 1. Connect to MongoDB
    logger.info('Connecting to MongoDB...');
    await connectDB();

    // 2. Connect to Redis
    logger.info('Connecting to Redis...');
    await connectRedis();

    // 2.5 Initialize rate limiter (after Redis is ready)
    logger.info('Initializing rate limiter...');
    initRateLimiter();

    // 3. Initialize BullMQ Queue (after Redis is connected)
    logger.info('Initializing job queue...');
    initializeQueue();

    // 4. Start BullMQ Worker
    logger.info('Starting job worker...');
    const workerInstance = startWorker();

    // 5. Start System Robustness Components
    // Memory Governor - monitors heap usage and takes protective actions
    logger.info('Starting Memory Governor...');
    memoryGovernor.start(workerInstance);

    // Queue Monitoring - enables backpressure management
    logger.info('Starting Queue Monitoring...');
    startQueueMonitoring();

    // Periodic Temp Cleanup - prevents memory leaks from orphaned files
    logger.info('Starting Periodic Temp Cleanup...');
    startPeriodicCleanup(2 * 60 * 1000); // Every 2 minutes

    // 6. Create and start Express server
    const app = createServer();
    const PORT = config.PORT;

    const server = app.listen(PORT, () => {
      logger.info(`✅ Server listening on port ${PORT}`);
      logger.info(`✅ Environment: ${config.NODE_ENV}`);
      logger.info(`✅ Queue concurrency: ${config.QUEUE_CONCURRENCY}`);
      logger.info(`✅ Rate limit: ${config.RATE_LIMIT_MAX} requests / 15 min`);
      logger.info(`✅ Memory Governor: Active`);
      logger.info(`✅ Queue Backpressure: Active`);
    });

    // 7. Graceful Shutdown Handler
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);

      // Stop accepting new connections
      server.close(() => {
        logger.info('HTTP server closed');
      });

      try {
        // Stop Memory Governor
        logger.info('Stopping Memory Governor...');
        memoryGovernor.stop();

        // Stop Degradation Service (cleanup in-memory fallback intervals)
        logger.info('Stopping Degradation Service...');
        const { degradationService } = await import('./services/degradation.service');
        degradationService.stop();

        // Stop Queue Monitoring
        logger.info('Stopping Queue Monitoring...');
        stopQueueMonitoring();

        // Stop Periodic Cleanup and do final cleanup
        logger.info('Stopping Periodic Cleanup and running final cleanup...');
        stopPeriodicCleanup();
        forceCleanupTempDir(undefined, 0); // Delete ALL temp files on shutdown

        // Stop the worker (finish current jobs)
        logger.info('Stopping worker...');
        await stopWorker();

        // Close queue connections
        logger.info('Closing queue...');
        await closeQueue();

        // Disconnect Redis
        logger.info('Disconnecting Redis...');
        await disconnectRedis();

        // Disconnect MongoDB
        logger.info('Disconnecting MongoDB...');
        await disconnectDB();

        logger.info('✅ Graceful shutdown completed');
        process.exit(0);

      } catch (err) {
        logger.error('Error during shutdown:', err);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err);
      shutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at promise:', { reason: String(reason) });
      // Don't shutdown on unhandled rejection - just log it
      // Node.js 15+ will crash by default anyway if --unhandled-rejections=strict
    });

  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application
bootstrap();

