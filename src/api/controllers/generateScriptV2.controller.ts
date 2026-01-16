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
 * 
 * UPDATED: Now supports storyFormat, extract mode, and remix
 */

import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { scriptGenerationSchema } from '../../validators/requestValidator';
import { normalizeInstagramUrl, generateReelHash, generateRequestHashV2 } from '../../utils/hash';
import { sessionManager } from '../../services/chatbot/sessionManager.service';

// Queue System (V3-style)
import { addScriptJob, canAcceptJob, ScriptJobData, StoryFormat } from '../../queue';
import { Job } from '../../db/models';

/**
 * Detect if user_idea is a special command (extract, remix, etc.)
 */
function parseUserIdea(userIdea: string): {
  isExtract: boolean;
  isRemix: boolean;
  remixType?: string;
  cleanIdea: string;
} {
  const lowerIdea = userIdea.toLowerCase().trim();

  // Extract mode keywords
  if (['extract', 'transcript', 'verbatim', 'raw', 'original', 'captions'].some(k => lowerIdea.includes(k))) {
    return { isExtract: true, isRemix: false, cleanIdea: userIdea };
  }

  // Remix keywords
  if (lowerIdea.includes('remix shorter') || lowerIdea === 'shorter') {
    return { isExtract: false, isRemix: true, remixType: 'shorter', cleanIdea: 'Make it shorter and punchier' };
  }
  if (lowerIdea.includes('remix longer') || lowerIdea === 'longer') {
    return { isExtract: false, isRemix: true, remixType: 'longer', cleanIdea: 'Make it longer with more detail' };
  }
  if (lowerIdea.includes('remix')) {
    return { isExtract: false, isRemix: true, remixType: 'custom', cleanIdea: userIdea.replace(/remix/gi, '').trim() };
  }

  return { isExtract: false, isRemix: false, cleanIdea: userIdea };
}

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
      mode: req.body.mode,
      // NEW: Story format support
      storyFormat: req.body.storyFormat as StoryFormat | undefined
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

    const storyFormat = normalizedBody.storyFormat;

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

    // 3. Get reel URL - either from request or from session (for restyling)
    let normalizedUrl = reel_url ? normalizeInstagramUrl(reel_url) : null;

    // If no reel_url provided, try to get from session (for Story/Edgy/Extract/Remix)
    if (!normalizedUrl && subscriber_id) {
      const session = await sessionManager.getSession(subscriber_id);
      if (session?.lastReelUrl) {
        normalizedUrl = session.lastReelUrl;
        logger.info(`[V2:${requestId}] Using cached reel from session: ${normalizedUrl.substring(0, 50)}`);
      }
    }

    if (!normalizedUrl) {
      res.status(400).json({
        success: false,
        message: 'reel_url is required (or send a reel first)'
      });
      return;
    }

    // 4. Parse user_idea for special commands
    const parsed = parseUserIdea(user_idea || '');
    const isCopyMode = parsed.isExtract;
    const finalUserIdea = parsed.cleanIdea || user_idea || '';

    // 5. Generate request hash for deduplication
    const requestHash = generateRequestHashV2(subscriber_id, normalizedUrl, finalUserIdea);

    // 6. Create job record in MongoDB (for tracking)
    await Job.create({
      jobId: requestId,
      subscriberId: subscriber_id,
      status: 'queued',
      reelUrl: normalizedUrl,
      userIdea: finalUserIdea,
      requestHash,
      createdAt: new Date()
    });

    // 7. Queue the job to BullMQ (processed by worker with concurrency control)
    const jobData: ScriptJobData = {
      requestId,
      requestHash,
      subscriberId: subscriber_id,
      reelUrl: normalizedUrl,
      userIdea: finalUserIdea,
      toneHint: tone_hint as ScriptJobData['toneHint'],
      languageHint: language_hint,
      mode: mode as 'full' | 'hook_only',
      isV2: true,  // Flag for V2 ManyChat field names
      // NEW: Story format and extract mode
      storyFormat: storyFormat,
      isCopyMode: isCopyMode
    };

    await addScriptJob(jobData);

    logger.info(`[V2:${requestId}] Job queued for subscriber ${subscriber_id}`, {
      reelUrl: normalizedUrl.substring(0, 50),
      hasIdea: !!finalUserIdea,
      storyFormat: storyFormat || 'default',
      isCopyMode,
      isRemix: parsed.isRemix
    });

    // 8. IMMEDIATE RESPONSE - Job is queued
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
