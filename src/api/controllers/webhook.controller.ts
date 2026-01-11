/**
 * Webhook Controller
 * 
 * Thin controller layer for ManyChat webhook endpoints.
 * Contains NO business logic - delegates everything to webhookService.
 * 
 * Responsibilities:
 * - Parse and validate HTTP request
 * - Call appropriate service method
 * - Format HTTP response
 * - Record metrics
 * 
 * @author ScriptFlow Team
 * @version 3.0.0
 */

import { Request, Response } from 'express';
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { webhookService, WebhookResult } from '../../services/external/webhook.service';
import { recordRequest, recordRequestDuration } from '../routes/metrics.routes';

// Validation
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// REQUEST VALIDATION SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Webhook request validation schema
 * 
 * Supports ManyChat payload structure:
 * - subscriber_id OR contact_id (for subscriber identification)
 * - user_idea OR last_text_input (for user message, from cuf_14126358)
 * - reel_url (from cuf_14126356)
 * - platform (e.g., "instagram")
 */
const webhookRequestSchema = z.object({
    // Accept either subscriber_id or contact_id
    subscriber_id: z.string().optional(),
    contact_id: z.string().optional(),
    // Accept either user_idea or last_text_input (from ManyChat custom field cuf_14126358)
    user_idea: z.string().optional(),
    last_text_input: z.string().optional(),
    // Reel URL (from ManyChat custom field cuf_14126356)
    // Use preprocess to handle empty strings from ManyChat when custom field is not set
    reel_url: z.preprocess(
        (val) => (val === '' || val === null || val === 'null' || val === 'undefined') ? undefined : val,
        z.string().url().optional()
    ),
    // Platform identifier (e.g., "instagram")
    platform: z.string().optional(),
    // Transform empty strings to undefined for optional enum fields
    tone_hint: z.preprocess(
        (val) => val === '' ? undefined : val,
        z.enum(['professional', 'funny', 'provocative', 'educational', 'casual']).optional()
    ),
    language_hint: z.preprocess(
        (val) => val === '' ? undefined : val,
        z.string().optional()
    ),
    mode: z.preprocess(
        (val) => val === '' ? undefined : val,
        z.enum(['full', 'hook_only']).optional()
    ),
    // Loop prevention fields
    source: z.string().optional(), // e.g., 'automation', 'user', 'broadcast'
    message_source: z.string().optional(), // ManyChat message source
}).refine(
    (data) => data.subscriber_id || data.contact_id,
    { message: 'Either subscriber_id or contact_id is required', path: ['subscriber_id'] }
);

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map WebhookResult to HTTP response
 */
function mapResultToResponse(result: WebhookResult): {
    status: number;
    body: Record<string, any>;
} {
    const baseBody = {
        status: result.success ? 'success' : 'error',
        action: result.action,
        message: result.message,
    };

    switch (result.action) {
        case 'queued':
            return {
                status: 200,
                body: {
                    ...baseBody,
                    jobId: result.data?.jobId,
                    state: result.data?.state,
                    rateLimit: result.data?.rateLimit,
                }
            };

        case 'cached':
            return {
                status: 200,
                body: {
                    ...baseBody,
                    cached: true,
                }
            };

        case 'prompted':
            return {
                status: 200,
                body: {
                    ...baseBody,
                    state: result.data?.state,
                }
            };

        case 'rate_limited':
            return {
                status: 429,
                body: {
                    ...baseBody,
                    code: 'USER_RATE_LIMIT_EXCEEDED',
                    rateLimit: result.data?.rateLimit,
                    retryAfter: result.data?.rateLimit?.resetInSeconds,
                }
            };

        case 'blocked':
            return {
                status: 403,
                body: {
                    ...baseBody,
                    code: 'USER_BLOCKED',
                }
            };

        case 'invalid_transition':
            return {
                status: 400,
                body: {
                    ...baseBody,
                    code: 'INVALID_TRANSITION',
                    currentState: result.data?.state,
                    validEvents: result.data?.validEvents,
                    error: result.data?.error,
                }
            };

        case 'ignored':
            return {
                status: 200, // Not an error, just silently ignored
                body: {
                    ...baseBody,
                    status: 'ignored',
                    code: result.data?.error?.code || 'LOOP_DETECTED',
                }
            };

        case 'error':
        default:
            return {
                status: 500,
                body: {
                    ...baseBody,
                    code: result.data?.error?.code || 'INTERNAL_ERROR',
                    error: result.data?.error,
                }
            };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Main webhook handler for ManyChat requests.
 * 
 * This is the unified V3 handler that uses:
 * - IntentClassifier for intent detection
 * - ChatbotStateMachine for state management
 * - WebhookService for business logic
 * 
 * NO BUSINESS LOGIC HERE - just request parsing and response formatting.
 */
export const webhookHandler = async (req: Request, res: Response): Promise<void> => {
    const requestId = req.requestId || crypto.randomUUID();
    const startTime = Date.now();

    try {
        // ─────────────────────────────────────────────────────────────────────────
        // 0. EARLY VALIDATION: Check subscriber_id FIRST before any processing
        // This prevents wasting resources on invalid requests
        // ─────────────────────────────────────────────────────────────────────────
        const rawSubscriberId = req.body?.subscriber_id || req.body?.contact_id;

        if (!rawSubscriberId || rawSubscriberId === '' || rawSubscriberId === 'null' || rawSubscriberId === 'undefined') {
            logger.warn(`[Controller:${requestId}] Invalid Subscriber ID`, {
                subscriber_id: rawSubscriberId,
                body: Object.keys(req.body || {}),
            });

            recordRequest({ flow: 'invalid_subscriber', status: 'error' });

            res.status(400).json({
                status: 'error',
                code: 'INVALID_SUBSCRIBER_ID',
                message: 'Invalid Subscriber ID: subscriber_id is null or missing',
                requestId,
            });
            return;
        }

        // Validate subscriber_id is a valid number/string for ManyChat
        const subscriberIdNum = parseInt(rawSubscriberId, 10);
        if (isNaN(subscriberIdNum) || subscriberIdNum <= 0) {
            logger.warn(`[Controller:${requestId}] Invalid Subscriber ID format`, {
                subscriber_id: rawSubscriberId,
                parsed: subscriberIdNum,
            });

            recordRequest({ flow: 'invalid_subscriber', status: 'error' });

            res.status(400).json({
                status: 'error',
                code: 'INVALID_SUBSCRIBER_ID',
                message: 'Invalid Subscriber ID: must be a valid positive number',
                requestId,
            });
            return;
        }

        // ─────────────────────────────────────────────────────────────────────────
        // 1. VALIDATE REQUEST (Full schema validation)
        // ─────────────────────────────────────────────────────────────────────────
        const parseResult = webhookRequestSchema.safeParse(req.body);

        if (!parseResult.success) {
            logger.warn(`[Controller:${requestId}] Validation failed`, {
                errors: parseResult.error.issues,
            });

            recordRequest({ flow: 'validation_error', status: 'error' });

            res.status(400).json({
                status: 'error',
                code: 'INVALID_INPUT',
                message: parseResult.error.issues.map(e => e.message).join(', '),
                errors: parseResult.error.issues,
            });
            return;
        }

        const {
            subscriber_id,
            contact_id,
            user_idea,
            last_text_input,
            reel_url,
            tone_hint,
            language_hint,
            mode,
            source,
            message_source
        } = parseResult.data;

        // Use whichever field was provided (subscriber_id or contact_id)
        const subscriberId = subscriber_id || contact_id || '';
        // Use whichever field was provided (user_idea or last_text_input)
        const rawMessage = user_idea || last_text_input || '';

        // ─────────────────────────────────────────────────────────────────────────
        // 2. DELEGATE TO SERVICE (Late-execution: heavy processing starts here)
        // At this point, we've validated the subscriber_id and input
        // ─────────────────────────────────────────────────────────────────────────
        const result: WebhookResult = await webhookService.processWebhook({
            subscriberId,
            rawMessage,
            reelUrl: reel_url,
            toneHint: tone_hint,
            languageHint: language_hint,
            mode,
            requestId,
            source: source || message_source, // Pass source for loop detection
        });

        // ─────────────────────────────────────────────────────────────────────────
        // 3. MAP RESULT TO HTTP RESPONSE
        // ─────────────────────────────────────────────────────────────────────────
        const { status, body } = mapResultToResponse(result);

        // ─────────────────────────────────────────────────────────────────────────
        // 4. RECORD METRICS
        // ─────────────────────────────────────────────────────────────────────────
        recordRequest({
            flow: result.data?.intent || 'unknown',
            status: result.action,
        });
        recordRequestDuration(Date.now() - startTime, { endpoint: 'webhook' });

        // ─────────────────────────────────────────────────────────────────────────
        // 5. SEND RESPONSE
        // ─────────────────────────────────────────────────────────────────────────
        res.status(status).json({
            ...body,
            requestId,
        });

    } catch (error: any) {
        logger.error(`[Controller:${requestId}] Unhandled error`, { error });

        recordRequest({ flow: 'error', status: 'error' });
        recordRequestDuration(Date.now() - startTime, { endpoint: 'webhook' });

        res.status(500).json({
            status: 'error',
            code: 'INTERNAL_ERROR',
            message: 'Something went wrong. Please try again!',
            requestId,
        });
    }
};

/**
 * Job status handler - check status of a queued job.
 */
export const jobStatusHandler = async (req: Request, res: Response): Promise<void> => {
    const { jobId } = req.params;

    try {
        // Import Job model dynamically to avoid circular deps
        const { Job } = await import('../../db/models');

        const job = await Job.findOne({ jobId }).lean();

        if (!job) {
            res.status(404).json({
                status: 'error',
                code: 'NOT_FOUND',
                message: 'Job not found',
            });
            return;
        }

        res.json({
            status: 'success',
            job: {
                id: job.jobId,
                status: job.status,
                attempts: job.attempts,
                createdAt: job.createdAt,
                completedAt: job.completedAt,
                processingTimeMs: job.processingTimeMs,
                error: job.error,
            },
        });

    } catch (error: any) {
        logger.error('Failed to get job status', { jobId, error });

        res.status(500).json({
            status: 'error',
            code: 'INTERNAL_ERROR',
            message: 'Failed to get job status',
        });
    }
};

/**
 * Health check handler for the webhook endpoint.
 */
export const webhookHealthHandler = async (req: Request, res: Response): Promise<void> => {
    res.json({
        status: 'ok',
        service: 'webhook',
        timestamp: new Date().toISOString(),
    });
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
    webhookHandler,
    jobStatusHandler,
    webhookHealthHandler,
};
