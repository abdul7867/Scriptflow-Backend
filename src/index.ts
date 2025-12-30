import { createServer } from './server';
import { connectDB, disconnectDB } from './db';
import { connectRedis, disconnectRedis, closeQueue, startWorker, stopWorker, initializeQueue } from './queue';
import { initRateLimiter } from './middleware';
import { logger } from './utils/logger';
import { config } from './config';
import fs from 'fs';
import path from 'path';

// Ensure temp directory exists
const tempDir = path.join(process.cwd(), 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// Initialize Instagram cookies from environment variable (for Docker deployments)
const COOKIES_PATH = '/app/cookies/instagram_cookies.txt';
if (process.env.INSTAGRAM_COOKIES) {
  try {
    // Ensure cookies directory exists
    const cookiesDir = path.dirname(COOKIES_PATH);
    if (!fs.existsSync(cookiesDir)) {
      fs.mkdirSync(cookiesDir, { recursive: true });
    }
    fs.writeFileSync(COOKIES_PATH, process.env.INSTAGRAM_COOKIES, 'utf-8');
    logger.info('Successfully initialized cookies from ENV');
    logger.info(`Instagram cookies initialized at ${COOKIES_PATH}`);
  } catch (err) {
    logger.error('Failed to write Instagram cookies from ENV:', err);
  }
} else {
  logger.warn('INSTAGRAM_COOKIES environment variable not set - Instagram downloads may fail');
}

/**
 * Application Bootstrap
 * Initializes all services in order and handles graceful shutdown
 */
async function bootstrap() {
  try {
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
    startWorker();

    // 4. Create and start Express server
    const app = createServer();
    const PORT = config.PORT;

    const server = app.listen(PORT, () => {
      logger.info(`✅ Server listening on port ${PORT}`);
      logger.info(`✅ Environment: ${config.NODE_ENV}`);
      logger.info(`✅ Queue concurrency: ${config.QUEUE_CONCURRENCY}`);
      logger.info(`✅ Rate limit: ${config.RATE_LIMIT_MAX} requests / 15 min`);
    });

    // 5. Graceful Shutdown Handler
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);

      // Stop accepting new connections
      server.close(() => {
        logger.info('HTTP server closed');
      });

      try {
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

        // Close browser if open
        // Browser service removed (replaced by Satori)

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
      logger.error(`Unhandled Rejection: ${reason}`);
    });

  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application
bootstrap();
