/**
 * Request Coalescer - Deduplicate identical requests
 * 
 * If multiple users request the SAME reel+idea within 60 seconds,
 * process ONCE and deliver to ALL waiting users.
 * 
 * This dramatically reduces processing load when content goes viral
 * or multiple users share the same trending reel.
 * 
 * @example
 * User1: reel_abc + "make it funny" → Creates job, registers coalesce
 * User2: reel_abc + "make it funny" → Coalesces, waits for User1's job
 * User3: reel_abc + "make it funny" → Coalesces, waits for User1's job
 * Job completes → Fan-out results to User1, User2, User3
 * 
 * @see implementation_plan.md - Strategy 2: Request Coalescing
 */

import { getRedis } from '../queue/redis';
import { logger } from '../utils/logger';
import { manychatStateService } from './external/manychatState.service';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface CoalescedRequest {
    /** The job ID that's actually processing */
    primaryJobId: string;
    /** All subscribers waiting for this result */
    subscribers: string[];
    /** When the coalesce group was created */
    createdAt: number;
    /** Request hash for verification */
    requestHash: string;
}

interface CoalesceResult {
    /** Whether this request was coalesced with an existing job */
    coalesced: boolean;
    /** The primary job ID (either new or existing) */
    jobId: string;
    /** Number of users waiting for this result */
    waitingCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/** How long to keep coalesce groups active (seconds) */
const COALESCE_TTL_SECONDS = 60;

/** Redis key prefix for coalesce groups */
const COALESCE_KEY_PREFIX = 'coalesce:';

// ═══════════════════════════════════════════════════════════════════════════
// COALESCER CLASS
// ═══════════════════════════════════════════════════════════════════════════

class RequestCoalescer {

    /**
     * Check if a request can be coalesced with an existing job
     * 
     * @param requestHash - Hash of reel URL + user idea
     * @param subscriberId - The user making this request
     * @returns Whether to coalesce and existing job ID if so
     */
    async checkCoalesce(
        requestHash: string,
        subscriberId: string
    ): Promise<{ shouldCoalesce: boolean; existingJobId?: string; position?: number }> {
        try {
            const redis = getRedis();
            const key = `${COALESCE_KEY_PREFIX}${requestHash}`;

            const data = await redis.get(key);

            if (!data) {
                return { shouldCoalesce: false };
            }

            const coalesced: CoalescedRequest = JSON.parse(data);

            // Check if this subscriber is already in the group
            if (coalesced.subscribers.includes(subscriberId)) {
                logger.debug('Subscriber already in coalesce group', {
                    requestHash,
                    subscriberId,
                    jobId: coalesced.primaryJobId
                });
                return {
                    shouldCoalesce: true,
                    existingJobId: coalesced.primaryJobId,
                    position: coalesced.subscribers.indexOf(subscriberId) + 1
                };
            }

            // Add subscriber to existing group
            coalesced.subscribers.push(subscriberId);
            await redis.setex(key, COALESCE_TTL_SECONDS, JSON.stringify(coalesced));

            logger.info('Request coalesced with existing job', {
                requestHash,
                subscriberId,
                primaryJobId: coalesced.primaryJobId,
                totalWaiting: coalesced.subscribers.length
            });

            return {
                shouldCoalesce: true,
                existingJobId: coalesced.primaryJobId,
                position: coalesced.subscribers.length
            };

        } catch (error) {
            logger.error('Coalesce check failed', { requestHash, error });
            // Fail open - don't coalesce if Redis fails
            return { shouldCoalesce: false };
        }
    }

    /**
     * Register a new job for coalescing
     * Called when we're creating a NEW job (not coalescing)
     */
    async registerJob(
        requestHash: string,
        jobId: string,
        subscriberId: string
    ): Promise<void> {
        try {
            const redis = getRedis();
            const key = `${COALESCE_KEY_PREFIX}${requestHash}`;

            const coalesced: CoalescedRequest = {
                primaryJobId: jobId,
                subscribers: [subscriberId],
                createdAt: Date.now(),
                requestHash
            };

            await redis.setex(key, COALESCE_TTL_SECONDS, JSON.stringify(coalesced));

            logger.debug('Registered job for coalescing', {
                requestHash,
                jobId,
                subscriberId
            });

        } catch (error) {
            logger.error('Failed to register coalesce job', { requestHash, jobId, error });
            // Non-fatal - job will still process, just won't coalesce
        }
    }

    /**
     * Fan out results to ALL waiting subscribers
     * Called when the primary job completes
     */
    async fanOutResults(
        requestHash: string,
        scriptText: string,
        imageUrl: string,
        scriptUrl: string,
        carouselImages?: {
            hookCard: string;
            bodyCard: string;
            ctaCard: string;
        }
    ): Promise<{ deliveredCount: number; failedCount: number }> {
        let deliveredCount = 0;
        let failedCount = 0;

        try {
            const redis = getRedis();
            const key = `${COALESCE_KEY_PREFIX}${requestHash}`;

            const data = await redis.get(key);

            if (!data) {
                logger.debug('No coalesce group found for fan-out', { requestHash });
                return { deliveredCount: 0, failedCount: 0 };
            }

            const coalesced: CoalescedRequest = JSON.parse(data);

            // Skip first subscriber (already delivered by primary job)
            const additionalSubscribers = coalesced.subscribers.slice(1);

            if (additionalSubscribers.length === 0) {
                logger.debug('No additional subscribers to fan out', { requestHash });
                await redis.del(key);
                return { deliveredCount: 0, failedCount: 0 };
            }

            logger.info('Fanning out results to coalesced subscribers', {
                requestHash,
                count: additionalSubscribers.length
            });

            // Deliver to each additional subscriber
            for (const subscriberId of additionalSubscribers) {
                try {
                    if (carouselImages) {
                        await manychatStateService.setReadyStateV2WithCarousel(
                            subscriberId,
                            scriptText,
                            carouselImages,
                            imageUrl,
                            scriptUrl
                        );
                    } else {
                        await manychatStateService.setReadyStateV2(
                            subscriberId,
                            scriptText,
                            imageUrl,
                            scriptUrl
                        );
                    }
                    deliveredCount++;

                    logger.debug('Fan-out delivery successful', { subscriberId });

                } catch (deliveryError) {
                    failedCount++;
                    logger.warn('Fan-out delivery failed', {
                        subscriberId,
                        error: deliveryError
                    });
                }
            }

            // Clean up coalesce group
            await redis.del(key);

            logger.info('Fan-out complete', {
                requestHash,
                deliveredCount,
                failedCount,
                totalWaiting: coalesced.subscribers.length
            });

        } catch (error) {
            logger.error('Fan-out failed', { requestHash, error });
        }

        return { deliveredCount, failedCount };
    }

    /**
     * Get coalesce statistics for a request
     */
    async getCoalesceInfo(requestHash: string): Promise<CoalescedRequest | null> {
        try {
            const redis = getRedis();
            const key = `${COALESCE_KEY_PREFIX}${requestHash}`;

            const data = await redis.get(key);
            if (!data) return null;

            return JSON.parse(data);

        } catch (error) {
            logger.error('Failed to get coalesce info', { requestHash, error });
            return null;
        }
    }

    /**
     * Cancel coalesce group (e.g., if primary job fails)
     */
    async cancelCoalesce(requestHash: string): Promise<void> {
        try {
            const redis = getRedis();
            const key = `${COALESCE_KEY_PREFIX}${requestHash}`;

            const data = await redis.get(key);
            if (!data) return;

            const coalesced: CoalescedRequest = JSON.parse(data);

            // Notify all waiting subscribers of failure
            for (const subscriberId of coalesced.subscribers.slice(1)) {
                try {
                    await manychatStateService.setErrorState(
                        subscriberId,
                        '❌ Script generation failed. Please try again!',
                        'coalesce_failed'
                    );
                } catch {
                    // Ignore individual notification failures
                }
            }

            await redis.del(key);

            logger.info('Coalesce group cancelled', {
                requestHash,
                affectedUsers: coalesced.subscribers.length - 1
            });

        } catch (error) {
            logger.error('Failed to cancel coalesce', { requestHash, error });
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

export const requestCoalescer = new RequestCoalescer();
export { RequestCoalescer };
export default requestCoalescer;
