/**
 * Clear Stuck States Script
 * 
 * Clears users stuck in PROCESSING state and resets them to IDLE.
 * Run this when the system has stuck sessions blocking new requests.
 * 
 * Usage: npx ts-node scripts/clear-stuck-states.ts
 */

import 'dotenv/config';
import { getRedis } from '../src/queue/redis';
import { logger } from '../src/utils/logger';
import { ChatbotState } from '../src/services/chatbot/chatbotStateMachine.service';

const FSM_KEY_PREFIX = 'fsm:state:';

async function clearStuckStates() {
    try {
        logger.info('🔍 Scanning for stuck PROCESSING states...');
        
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
        
        // Scan for all FSM keys
        const keys: string[] = [];
        let cursor = '0';
        
        do {
            const [newCursor, foundKeys] = await redis.scan(
                cursor,
                'MATCH',
                `${FSM_KEY_PREFIX}*`,
                'COUNT',
                100
            );
            cursor = newCursor;
            keys.push(...foundKeys);
        } while (cursor !== '0');
        
        logger.info(`Found ${keys.length} FSM states`);
        
        let stuckCount = 0;
        let clearedCount = 0;
        
        for (const key of keys) {
            const data = await redis.get(key);
            if (!data) continue;
            
            const state = JSON.parse(data);
            
            // Check if stuck in PROCESSING state
            if (state.currentState === ChatbotState.PROCESSING || state.currentState === 'PROCESSING') {
                const subscriberId = key.replace(FSM_KEY_PREFIX, '');
                const lastTransition = new Date(state.lastTransitionAt);
                const now = new Date();
                const minutesStuck = Math.round((now.getTime() - lastTransition.getTime()) / 1000 / 60);
                
                logger.warn(`Found stuck state: ${subscriberId} (stuck for ${minutesStuck} minutes)`);
                stuckCount++;
                
                // Reset to IDLE state
                const resetState = {
                    ...state,
                    currentState: ChatbotState.IDLE,
                    previousState: state.currentState,
                    lastEvent: 'RESET',
                    lastTransitionAt: new Date().toISOString(),
                    metadata: {
                        ...state.metadata,
                        clearedByScript: true,
                        clearedAt: new Date().toISOString(),
                        wasStuck: true,
                    }
                };
                
                await redis.setex(key, 3600, JSON.stringify(resetState));
                logger.info(`✅ Cleared ${subscriberId} → IDLE`);
                clearedCount++;
            }
        }
        
        logger.info('─────────────────────────────────────');
        logger.info(`✅ Scan complete`);
        logger.info(`   Total states: ${keys.length}`);
        logger.info(`   Stuck states found: ${stuckCount}`);
        logger.info(`   States cleared: ${clearedCount}`);
        
        if (clearedCount > 0) {
            logger.info('');
            logger.info('🎉 Users can now submit new requests!');
        } else {
            logger.info('');
            logger.info('No stuck states found. System is healthy.');
        }
        
        process.exit(0);
        
    } catch (error) {
        logger.error('Failed to clear stuck states:', error);
        process.exit(1);
    }
}

// Run the script
clearStuckStates();
