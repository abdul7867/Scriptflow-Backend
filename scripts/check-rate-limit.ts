/**
 * Check Rate Limit Status Script
 * 
 * Check and optionally reset rate limit for a specific user
 * 
 * Usage: npx ts-node scripts/check-rate-limit.ts [subscriberId]
 */

import 'dotenv/config';
import { getRedis } from '../src/queue/redis';
import { logger } from '../src/utils/logger';

const SUBSCRIBER_ID = process.argv[2] || '12345678';
const RATE_LIMIT_PREFIX = 'user_rl:';

async function checkRateLimit() {
    try {
        logger.info(`🔍 Checking rate limit for subscriber: ${SUBSCRIBER_ID}`);
        
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
        const ttl = await redis.ttl(key);
        
        logger.info('─────────────────────────────────────');
        logger.info(`Rate Limit Status for ${SUBSCRIBER_ID}:`);
        logger.info(`  Current count: ${count || 0}`);
        logger.info(`  Limit: 10`);
        logger.info(`  Remaining: ${10 - (count ? parseInt(count) : 0)}`);
        logger.info(`  Reset in: ${ttl > 0 ? Math.ceil(ttl / 60) : 0} minutes (${ttl}s)`);
        logger.info('─────────────────────────────────────');
        
        // Offer to reset
        if (count && parseInt(count) >= 10) {
            logger.info('');
            logger.warn('⚠️  User is at/over limit!');
            logger.info('');
            logger.info('To reset, run: npx ts-node scripts/reset-rate-limit.ts ' + SUBSCRIBER_ID);
        }
        
        process.exit(0);
        
    } catch (error) {
        logger.error('Failed to check rate limit:', error);
        process.exit(1);
    }
}

// Run the script
checkRateLimit();
