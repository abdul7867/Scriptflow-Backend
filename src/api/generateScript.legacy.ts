import { Request, Response } from 'express';
import crypto from 'crypto';
import { scriptGenerationSchema } from '../validators/requestValidator';
import { generateRequestHash, normalizeInstagramUrl } from '../utils/hash';
import { logger } from '../utils/logger';

// Database
import { Script, Job } from '../db/models';

// Queue
import { addScriptJob } from '../queue';

// ============================================
// SMART MODE DETECTION
// Detects mode from user_idea keywords when not explicitly provided
// ============================================
type GenerationMode = 'full' | 'hook_only';

const HOOK_ONLY_PATTERNS = [
  /\bhook\s*only\b/i,
  /\bjust\s*(the\s*)?hook\b/i,
  /\bonly\s*(the\s*)?hook\b/i,
  /\bgive\s*me\s*(the\s*)?hook\b/i,
  /\bstart(ing)?\s*(with\s*)?(the\s*)?hook\b/i,
  /\bfirst\s*line\s*only\b/i,
  /\bopening\s*line\s*only\b/i,
  /🎣/  // Hook emoji as a shortcut
];

/**
 * Detect generation mode from user_idea text
 * Returns 'hook_only' if keywords match, otherwise 'full'
 */
function detectModeFromIdea(userIdea: string): GenerationMode {
  const normalizedIdea = userIdea.toLowerCase().trim();
  
  for (const pattern of HOOK_ONLY_PATTERNS) {
    if (pattern.test(normalizedIdea)) {
      return 'hook_only';
    }
  }
  
  return 'full';
}

/**
 * Clean user_idea by removing mode-related keywords
 * This ensures the AI focuses on the actual content idea
 */
function cleanUserIdea(userIdea: string): string {
  let cleaned = userIdea;
  
  // Remove hook-only keywords but keep the rest of the idea
  const removePatterns = [
    /\bhook\s*only\b/gi,
    /\bjust\s*(the\s*)?hook\s*(for\s*)?/gi,
    /\bonly\s*(the\s*)?hook\s*(for\s*)?/gi,
    /\bgive\s*me\s*(the\s*)?hook\s*(for\s*)?/gi,
    /🎣\s*/g
  ];
  
  for (const pattern of removePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // Clean up extra whitespace
  return cleaned.trim().replace(/\s+/g, ' ');
}

/**
 * ASYNC HANDLER with BullMQ
 * 
 * Flow:
 * 1. Validate request
 * 2. Smart mode detection from user_idea
 * 3. Check cache (idempotency)
 * 4. Add job to BullMQ queue
 * 5. Return immediate response
 * 6. Worker processes job in background
 * 7. Worker sends result via ManyChat API
 */
export const generateScriptHandler = async (req: Request, res: Response) => {
  const requestId = crypto.randomUUID();

  try {
    // 1. Validation
    const parseResult = scriptGenerationSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn('Validation failed', parseResult.error);
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_INPUT',
        message: parseResult.error.issues.map(e => e.message).join(', ')
      });
    }

    const { subscriber_id, reel_url: rawReelUrl, user_idea: rawUserIdea, tone_hint, language_hint, mode: explicitMode } = parseResult.data;
    
    // 2. SMART MODE DETECTION
    // Priority: explicit mode > detected from user_idea > default 'full'
    const detectedMode = detectModeFromIdea(rawUserIdea);
    const finalMode: GenerationMode = explicitMode || detectedMode;
    
    // Clean the user_idea if hook-only mode was detected from keywords
    const user_idea = detectedMode === 'hook_only' && !explicitMode 
      ? cleanUserIdea(rawUserIdea) 
      : rawUserIdea;
    
    if (detectedMode === 'hook_only' && !explicitMode) {
      logger.info(`[${requestId}] Smart mode detection: hook_only (detected from keywords)`);
    }
    
    // EXPERT: Normalize URL immediately to ensure consistency across DB and Caches
    const reel_url = normalizeInstagramUrl(rawReelUrl);
    
    // Tier 2 cache key: includes all parameters for full script matching
    const requestHash = generateRequestHash(subscriber_id, reel_url, user_idea, language_hint || undefined, tone_hint || undefined, finalMode);

    // 2. Idempotency Check (MongoDB) - Tier 2 Cache
    const cachedScript = await Script.findOne({ requestHash }).lean();
    if (cachedScript) {
      logger.info(`Tier 2 Cache hit: ${requestHash}`);
      return res.json({
        status: 'success',
        cached: true,
        message: 'I found a matching script instantly! Here it is.',
        script: cachedScript.scriptText,
        imageUrl: cachedScript.imageUrl || null,
        scriptUrl: cachedScript.scriptUrl || null
      });
    }


    // 3. Check if job already exists (prevent duplicate processing)
    const existingJob = await Job.findOne({ 
      requestHash, 
      status: { $in: ['queued', 'processing'] } 
    });
    
    if (existingJob) {
      logger.info(`Job already in queue: ${existingJob.jobId}`);
      return res.json({
        status: 'queued',
        jobId: existingJob.jobId,
        message: 'Your script is already being processed. Please wait!'
      });
    }

    // 4. Create job record in MongoDB
    await Job.create({
      jobId: requestId,
      subscriberId: subscriber_id,
      status: 'queued',
      reelUrl: reel_url,
      userIdea: user_idea,
      requestHash,
      attempts: 0
    });

    // 5. Add to BullMQ queue (with optional hints)
    // CLEANUP: Ensure empty strings or nulls are converted to undefined for Type safety
    await addScriptJob({
      requestId,
      requestHash,
      subscriberId: subscriber_id,
      reelUrl: reel_url,
      userIdea: user_idea,
      toneHint: tone_hint || undefined,
      languageHint: language_hint || undefined,
      mode: finalMode
    });

    logger.info(`[${requestId}] Job queued for user ${subscriber_id}`);

    // 6. Immediate response (prevents ManyChat timeout)
    res.json({
      status: 'queued',
      jobId: requestId,
      message: 'Analyzing your reel... I will send the script in a new message shortly!'
    });

  } catch (error: any) {
    logger.error(`[${requestId}] Failed to queue job:`, error);
    
    res.status(500).json({
      status: 'error',
      code: 'QUEUE_ERROR',
      message: 'Failed to process request. Please try again.'
    });
  }
};

/**
 * Get job status (optional endpoint for debugging)
 */
export const getJobStatusHandler = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    
    const job = await Job.findOne({ jobId }).lean();
    
    if (!job) {
      return res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Job not found'
      });
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
        error: job.error
      }
    });

  } catch (error) {
    logger.error('Failed to get job status:', error);
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to get job status'
    });
  }
};
