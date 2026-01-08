/**
 * Clear BullMQ Jobs Script
 * 
 * Clears stuck/stale jobs from the script queue.
 * Run this when the queue has stuck jobs causing issues.
 * 
 * Usage: npx ts-node scripts/clear-bullmq-jobs.ts
 */

import 'dotenv/config';
import { Queue } from 'bullmq';
import { getRedis } from '../src/queue/redis';
import { logger } from '../src/utils/logger';

const QUEUE_NAME = 'script-queue';

async function clearBullMQJobs() {
    try {
        logger.info('🔍 Connecting to Redis for BullMQ cleanup...');
        
        const redis = getRedis();
        
        // Wait for Redis to connect
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Redis connection timeout')), 30000);
            
            if (redis.status === 'ready') {
                clearTimeout(timeout);
                resolve(true);
            } else {
                redis.once('ready', () => {
                    clearTimeout(timeout);
                    resolve(true);
                });
                redis.once('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            }
        });
        
        logger.info('✅ Redis connected');
        
        // Create queue instance
        const queue = new Queue(QUEUE_NAME, {
            connection: redis,
        });
        
        // Get job counts
        const counts = await queue.getJobCounts(
            'wait', 'active', 'completed', 'failed', 'delayed', 'paused'
        );
        
        logger.info('📊 Current queue state:');
        logger.info(`   Waiting: ${counts.wait}`);
        logger.info(`   Active: ${counts.active}`);
        logger.info(`   Completed: ${counts.completed}`);
        logger.info(`   Failed: ${counts.failed}`);
        logger.info(`   Delayed: ${counts.delayed}`);
        logger.info(`   Paused: ${counts.paused}`);
        
        const totalJobs = counts.wait + counts.active + counts.delayed + counts.failed;
        
        if (totalJobs === 0) {
            logger.info('✅ Queue is clean, no stuck jobs!');
        } else {
            logger.info(`\n🧹 Cleaning ${totalJobs} stuck jobs...`);
            
            // Drain waiting jobs
            if (counts.wait > 0) {
                await queue.drain();
                logger.info(`   ✓ Drained ${counts.wait} waiting jobs`);
            }
            
            // Clean completed jobs (older than 0ms = all)
            await queue.clean(0, 1000, 'completed');
            logger.info(`   ✓ Cleaned completed jobs`);
            
            // Clean failed jobs
            await queue.clean(0, 1000, 'failed');
            logger.info(`   ✓ Cleaned failed jobs`);
            
            // Obliterate the queue (nuclear option - removes everything)
            const obliterate = process.argv.includes('--force');
            if (obliterate) {
                await queue.obliterate({ force: true });
                logger.info('   ✓ Queue obliterated (force mode)');
            }
            
            // Get updated counts
            const newCounts = await queue.getJobCounts(
                'wait', 'active', 'completed', 'failed', 'delayed', 'paused'
            );
            
            logger.info('\n📊 Queue state after cleanup:');
            logger.info(`   Waiting: ${newCounts.wait}`);
            logger.info(`   Active: ${newCounts.active}`);
            logger.info(`   Completed: ${newCounts.completed}`);
            logger.info(`   Failed: ${newCounts.failed}`);
            logger.info(`   Delayed: ${newCounts.delayed}`);
        }
        
        await queue.close();
        await redis.quit();
        
        logger.info('\n✅ Cleanup complete!');
        process.exit(0);
        
    } catch (error) {
        logger.error('❌ Failed to clear BullMQ jobs:', error);
        process.exit(1);
    }
}

clearBullMQJobs();
