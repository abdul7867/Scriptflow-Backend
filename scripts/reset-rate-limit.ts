/**
 * Reset Rate Limit Script
 * 
 * Reset rate limit counter for a specific user
 * 
 * Usage: npx ts-node scripts/reset-rate-limit.ts [subscriberId]
 */

import 'dotenv/config';
import { getRedis } from '../src/queue/redis';
import { logger } from '../src/utils/logger';

const SUBSCRIBER_ID = process.argv[2] || '12345678';
const RATE_LIMIT_PREFIX = 'user_rl:';

async function resetRateLimit() {
    try {
        logger.info(`🔄 Resetting rate limit for subscriber: ${SUBSCRIBER_ID}`);
        
        const redis = getRedis();
        
        // Wait for Redis to connect
        await new Promise((resolve) => {
            if (redis.status === 'ready') {
                resolve(true);
            } else {
                redis.once('ready', () => resolve(true));
            }
        });
        
        logger.info('✅ Redis connected');
        
        const key = `${RATE_LIMIT_PREFIX}${SUBSCRIBER_ID}`;
        const count = await redis.get(key);
        
        if (!count) {
            logger.info('');
            logger.info('No rate limit found for this user. Counter is at 0.');
            process.exit(0);
        }
        
        // Delete the key to reset
        await redis.del(key);
        
        logger.info('─────────────────────────────────────');
        logger.info(`✅ Rate limit reset for ${SUBSCRIBER_ID}`);
        logger.info(`   Previous count: ${count}`);
        logger.info(`   New count: 0`);
        logger.info(`   Available requests: 10`);
        logger.info('─────────────────────────────────────');
        
        process.exit(0);
        
    } catch (error) {
        logger.error('Failed to reset rate limit:', error);
        process.exit(1);
    }
}

// Run the script
resetRateLimit();
