/**
 * ScriptGeneration Controller V2 - Queue-Based Implementation
 * 
 * UPGRADED: Now uses BullMQ queue system (same as V3) for:
 * - Memory safety with controlled concurrency
 * - Proper backpressure handling
 * - Retry on failure
 * 
 * Goals:
 * 1. Receive request -> Queue job -> Immediate 200 OK
 * 2. Worker processes: Download -> Analyze -> Generate Script -> Generate Image
 * 3. Update ManyChat custom fields:
 *    - ai_generated_script -> Script text
 *    - script_image -> Image URL
 *    - script_copy_link -> Webpage URL
 */

import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { scriptGenerationSchema } from '../../validators/requestValidator';
import { normalizeInstagramUrl, generateReelHash, generateRequestHashV2 } from '../../utils/hash';

// Queue System (V3-style)
import { addScriptJob, canAcceptJob, ScriptJobData } from '../../queue';
import { Job } from '../../db/models';

/**
 * Main Handler: Queue-Based (V3-style)
 * 
 * Instead of running background tasks in the same process,
 * we queue jobs to BullMQ which are processed by the worker
 * with controlled concurrency (default: 2).
 */
export const generateScriptHandlerV2 = async (req: Request, res: Response): Promise<void> => {
  const requestId = `v2_${crypto.randomUUID()}`;
  const startTime = Date.now();

  try {
    // Normalize field names from ManyChat (accept both naming conventions)
    // ManyChat sends: user_message, user_reel
    // Schema expects: user_idea, reel_url
    const normalizedBody = {
      subscriber_id: req.body.subscriber_id,
      reel_url: req.body.reel_url || req.body.user_reel,
      user_idea: req.body.user_idea || req.body.user_message,
      tone_hint: req.body.tone_hint,
      language_hint: req.body.language_hint,
      mode: req.body.mode
    };

    // 1. Validate Request
    const parseResult = scriptGenerationSchema.safeParse(normalizedBody);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        message: parseResult.error.issues.map(e => e.message).join(', ')
      });
      return;
    }

    const {
      subscriber_id,
      reel_url,
      user_idea,
      tone_hint,
      language_hint,
      mode
    } = parseResult.data;

    // 2. Check if queue can accept jobs (backpressure)
    const canAccept = await canAcceptJob();
    if (!canAccept) {
      logger.warn(`[V2:${requestId}] Queue backpressure active, rejecting request`);
      res.status(503).json({
        success: false,
        message: '🔄 System is busy! Please try again in 1 minute.',
        retryAfter: 60
      });
      return;
    }

    // 3. Validate reel URL
    if (!reel_url) {
      res.status(400).json({
        success: false,
        message: 'reel_url is required'
      });
      return;
    }

    // 4. Generate request hash for deduplication
    const normalizedUrl = normalizeInstagramUrl(reel_url);
    const requestHash = generateRequestHashV2(subscriber_id, normalizedUrl, user_idea || '');

    // 5. Create job record in MongoDB (for tracking)
    await Job.create({
      jobId: requestId,
      subscriberId: subscriber_id,
      status: 'queued',
      reelUrl: normalizedUrl,
      userIdea: user_idea || '',
      createdAt: new Date()
    });

    // 6. Queue the job to BullMQ (processed by worker with concurrency control)
    const jobData: ScriptJobData = {
      requestId,
      requestHash,
      subscriberId: subscriber_id,
      reelUrl: normalizedUrl,
      userIdea: user_idea || '',
      toneHint: tone_hint as ScriptJobData['toneHint'],
      languageHint: language_hint,
      mode: mode as 'full' | 'hook_only',
      isV2: true  // Flag for V2 ManyChat field names
    };

    await addScriptJob(jobData);

    logger.info(`[V2:${requestId}] Job queued for subscriber ${subscriber_id}`, {
      reelUrl: normalizedUrl.substring(0, 50),
      hasIdea: !!user_idea
    });

    // 7. IMMEDIATE RESPONSE - Job is queued
    res.status(200).json({
      success: true,
      message: 'Script generation started',
      jobId: requestId
    });

  } catch (error: any) {
    logger.error(`[V2:${requestId}] Error queueing request`, { error: error.message });
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
  }
};

export default {
  generateScriptHandlerV2
};
