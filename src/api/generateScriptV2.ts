/**
 * ScriptFlow 2.0 - Unified Script Generation API
 * 
 * This is the main entry point for ManyChat webhook requests.
 * It handles both guided and instant flows with a unified smart flow.
 * 
 * Flow Detection:
 * - "generate", "go", "remix" + reel → Instant flow (AI picks default idea)
 * - "another", "again", "🔄" → Redo flow (use cached context)
 * - reel + custom idea → Guided flow (user provides idea)
 * - reel only → Prompt for idea
 */

import { Request, Response } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

// Validation
import { scriptGenerationSchema } from '../validators/requestValidator';

// Utilities
import { generateRequestHashV2, normalizeInstagramUrl, generateReelHash } from '../utils/hash';
import { detectTrigger, containsReelUrl, extractReelUrl, TriggerResult } from '../utils/triggerDetector';
import { getDefaultIdea, getIdeaVariation, isDefaultIdea } from '../utils/defaultIdeas';

// Services
import { SessionManager, SessionState } from '../services/sessionManager';
import { sendTextMessage, sendCarousel } from '../services/manychat';
import { generateCarouselImages } from '../services/carouselGenerator';

// Database
import { Script, Job, ReelDNA } from '../db/models';
import { UserMemory } from '../db/models/UserMemory';

// Queue
import { addScriptJob, addCopyJob } from '../queue';

// Metrics
import { recordRequest, recordCacheResult, recordRequestDuration } from './metrics';

// Rate limiting
import { getUserRateLimitStatus } from '../middleware/userRateLimiter';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type GenerationMode = 'full' | 'hook_only';
type FlowType = 'instant' | 'guided' | 'redo' | 'prompt_idea';

interface ProcessedRequest {
  flowType: FlowType;
  reelUrl: string;
  userIdea: string;
  mode: GenerationMode;
  variationIndex: number;
  toneHint?: string;
  languageHint?: string;
  isVariation: boolean;
  fromCache?: boolean;
  isCopyMode?: boolean; // When true, output transcript as-is formatted as script
  isSoftLimitReached?: boolean; // True when user has generated many variations
  totalVariations?: number; // Total number of variations for this reel+idea
}

// ═══════════════════════════════════════════════════════════════════════════
// MODE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

const HOOK_ONLY_PATTERNS = [
  /\bhook\s*only\b/i,
  /\bjust\s*(the\s*)?hook\b/i,
  /\bonly\s*(the\s*)?hook\b/i,
  /\bgive\s*me\s*(the\s*)?hook\b/i,
  /\bstart(ing)?\s*(with\s*)?(the\s*)?hook\b/i,
  /\bfirst\s*line\s*only\b/i,
  /\bopening\s*line\s*only\b/i,
  /🎣/  // Hook emoji as shortcut
];

function detectMode(userIdea: string): GenerationMode {
  for (const pattern of HOOK_ONLY_PATTERNS) {
    if (pattern.test(userIdea)) {
      return 'hook_only';
    }
  }
  return 'full';
}

function cleanModeKeywords(userIdea: string): string {
  let cleaned = userIdea;
  const patterns = [
    /\bhook\s*only\b/gi,
    /\bjust\s*(the\s*)?hook\s*(for\s*)?/gi,
    /\bonly\s*(the\s*)?hook\s*(for\s*)?/gi,
    /\bgive\s*me\s*(the\s*)?hook\s*(for\s*)?/gi,
    /🎣\s*/g
  ];
  
  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  return cleaned.trim().replace(/\s+/g, ' ');
}

// ═══════════════════════════════════════════════════════════════════════════
// REQUEST PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process incoming request and determine flow type
 */
async function processRequest(
  subscriberId: string,
  rawMessage: string,
  rawReelUrl?: string,
  explicitMode?: GenerationMode,
  toneHint?: string,
  languageHint?: string
): Promise<ProcessedRequest> {
  const sessionManager = new SessionManager();
  const session = await sessionManager.getSession(subscriberId);
  
  // Detect trigger type from message
  const trigger = detectTrigger(rawMessage);
  
  // Check if message contains a reel URL (could be in message or explicit param)
  const hasReelInMessage = containsReelUrl(rawMessage);
  const messageReelUrl = hasReelInMessage ? extractReelUrl(rawMessage) : null;
  const reelUrl = rawReelUrl || messageReelUrl;
  
  // Get user memory for smart defaults
  let userMemory;
  try {
    userMemory = await UserMemory.getOrCreate(subscriberId);
  } catch (e) {
    logger.warn(`Failed to get user memory: ${e}`);
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // FLOW 1: REDO (another, again, 🔄)
  // ─────────────────────────────────────────────────────────────────────────
  if (trigger.isRedo && session.lastReelUrl) {
    logger.info(`[${subscriberId}] REDO flow detected`);
    
    const variationResult = await sessionManager.getAndIncrementVariation(
      subscriberId,
      session.lastReelUrl,
      session.lastUserIdea || ''
    );
    
    // Use stored context but generate new variation
    return {
      flowType: 'redo',
      reelUrl: session.lastReelUrl,
      userIdea: session.lastUserIdea || getDefaultIdea().idea,
      mode: explicitMode || 'full',
      variationIndex: variationResult.variationIndex,
      toneHint: trigger.detectedTone || toneHint || userMemory?.preferences?.preferredTone,
      languageHint: languageHint || userMemory?.preferences?.preferredLanguage,
      isVariation: true,
      isSoftLimitReached: variationResult.isSoftLimitReached,
      totalVariations: variationResult.totalVariations,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // FLOW 1.5: COPY (copy, save, download + reel) - Now generates transcript-as-script
  // ─────────────────────────────────────────────────────────────────────────
  if (trigger.isCopyFlow && reelUrl) {
    logger.info(`[${subscriberId}] COPY flow detected - will output transcript as script`);
    
    const normalizedUrl = normalizeInstagramUrl(reelUrl);
    
    // Store in session
    await sessionManager.setReelUrl(subscriberId, normalizedUrl);
    
    // Route to instant flow but with isCopyMode flag
    // This tells the worker to output the exact transcript formatted as a script
    return {
      flowType: 'instant',
      reelUrl: normalizedUrl,
      userIdea: 'COPY_EXACT_TRANSCRIPT', // Special marker for copy mode
      mode: 'full',
      variationIndex: 0,
      toneHint: trigger.detectedTone || toneHint || userMemory?.preferences?.preferredTone,
      languageHint: languageHint || userMemory?.preferences?.preferredLanguage,
      isVariation: false,
      isCopyMode: true, // This triggers transcript-as-script output
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // FLOW 2: INSTANT (generate, go, remix + reel)
  // ─────────────────────────────────────────────────────────────────────────
  if (trigger.isInstantFlow && reelUrl) {
    logger.info(`[${subscriberId}] INSTANT flow detected`);
    
    // Normalize URL for caching
    const normalizedUrl = normalizeInstagramUrl(reelUrl);
    
    // Try to detect niche from cached ReelDNA
    let detectedNiche: string | undefined;
    try {
      const reelHash = generateReelHash(normalizedUrl);
      const cachedDNA = await ReelDNA.findOne({ reelUrlHash: reelHash }).lean();
      if (cachedDNA?.analysis?.hookType) {
        detectedNiche = cachedDNA.analysis.hookType;
      }
    } catch (e) {
      // Non-critical
    }
    
    // Get smart default idea based on niche or user preferences
    const userNiche = userMemory?.preferences?.preferredNiches?.[0] || detectedNiche;
    const defaultIdeaResult = getDefaultIdea({ niche: userNiche });
    const defaultIdea = defaultIdeaResult.idea;
    
    // Get variation index
    const variationResult = await sessionManager.getAndIncrementVariation(
      subscriberId,
      normalizedUrl,
      defaultIdea
    );
    
    // Store in session for redo
    await sessionManager.setReelUrl(subscriberId, normalizedUrl);
    await sessionManager.setUserIdea(subscriberId, defaultIdea);
    
    return {
      flowType: 'instant',
      reelUrl: normalizedUrl,
      userIdea: defaultIdea,
      mode: explicitMode || 'full',
      variationIndex: variationResult.variationIndex,
      toneHint: trigger.detectedTone || toneHint || userMemory?.preferences?.preferredTone,
      languageHint: languageHint || userMemory?.preferences?.preferredLanguage,
      isVariation: variationResult.variationIndex > 0,
      isSoftLimitReached: variationResult.isSoftLimitReached,
      totalVariations: variationResult.totalVariations,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // FLOW 3: GUIDED (reel + custom idea)
  // ─────────────────────────────────────────────────────────────────────────
  if (reelUrl && trigger.cleanedMessage && trigger.cleanedMessage.length > 3) {
    logger.info(`[${subscriberId}] GUIDED flow detected`);
    
    const normalizedUrl = normalizeInstagramUrl(reelUrl);
    const userIdea = trigger.cleanedMessage;
    const detectedMode = detectMode(userIdea);
    const cleanedIdea = detectedMode === 'hook_only' ? cleanModeKeywords(userIdea) : userIdea;
    
    // Get variation index (0 for first request with this idea)
    const variationResult = await sessionManager.getAndIncrementVariation(
      subscriberId,
      normalizedUrl,
      cleanedIdea
    );
    
    // Store in session for redo
    await sessionManager.setReelUrl(subscriberId, normalizedUrl);
    await sessionManager.setUserIdea(subscriberId, cleanedIdea);
    
    return {
      flowType: 'guided',
      reelUrl: normalizedUrl,
      userIdea: cleanedIdea,
      mode: explicitMode || detectedMode,
      variationIndex: variationResult.variationIndex,
      toneHint: trigger.detectedTone || toneHint || userMemory?.preferences?.preferredTone,
      languageHint: languageHint || userMemory?.preferences?.preferredLanguage,
      isVariation: variationResult.variationIndex > 0,
      isSoftLimitReached: variationResult.isSoftLimitReached,
      totalVariations: variationResult.totalVariations,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // FLOW 4: PROMPT FOR IDEA (reel only, no trigger)
  // ─────────────────────────────────────────────────────────────────────────
  if (reelUrl) {
    logger.info(`[${subscriberId}] Reel received, prompting for idea`);
    
    const normalizedUrl = normalizeInstagramUrl(reelUrl);
    
    // Store reel and set state to awaiting idea
    await sessionManager.setReelUrl(subscriberId, normalizedUrl);
    await sessionManager.setState(subscriberId, 'awaiting_idea');
    
    return {
      flowType: 'prompt_idea',
      reelUrl: normalizedUrl,
      userIdea: '',
      mode: 'full',
      variationIndex: 0,
      isVariation: false,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // FLOW 5: AWAITING IDEA (user sent idea after reel)
  // ─────────────────────────────────────────────────────────────────────────
  if (session.conversationState === 'awaiting_idea' && session.lastReelUrl && rawMessage.length > 3) {
    logger.info(`[${subscriberId}] Received idea for stored reel`);
    
    const userIdea = rawMessage.trim();
    const detectedMode = detectMode(userIdea);
    const cleanedIdea = detectedMode === 'hook_only' ? cleanModeKeywords(userIdea) : userIdea;
    
    const variationResult = await sessionManager.getAndIncrementVariation(
      subscriberId,
      session.lastReelUrl,
      cleanedIdea
    );
    
    await sessionManager.setUserIdea(subscriberId, cleanedIdea);
    await sessionManager.setState(subscriberId, 'processing');
    
    return {
      flowType: 'guided',
      reelUrl: session.lastReelUrl,
      userIdea: cleanedIdea,
      mode: explicitMode || detectedMode,
      variationIndex: variationResult.variationIndex,
      toneHint: trigger.detectedTone || toneHint || userMemory?.preferences?.preferredTone,
      languageHint: languageHint || userMemory?.preferences?.preferredLanguage,
      isVariation: variationResult.variationIndex > 0,
      isSoftLimitReached: variationResult.isSoftLimitReached,
      totalVariations: variationResult.totalVariations,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // FALLBACK: No reel, prompt user
  // ─────────────────────────────────────────────────────────────────────────
  throw new Error('NO_REEL_PROVIDED');
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER - V2 UNIFIED FLOW
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Unified Script Generation Handler (v2)
 * 
 * This replaces the old handler with smart flow detection.
 */
export const generateScriptHandlerV2 = async (req: Request, res: Response) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  
  try {
    // 1. Validate request
    const parseResult = scriptGenerationSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn('Validation failed', parseResult.error);
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_INPUT',
        message: parseResult.error.issues.map((e: any) => e.message).join(', ')
      });
    }
    
    const { 
      subscriber_id, 
      reel_url: rawReelUrl, 
      user_idea: rawUserIdea,
      tone_hint,
      language_hint,
      mode: explicitMode
    } = parseResult.data;
    
    // 2. Process request and determine flow
    let processed: ProcessedRequest;
    try {
      processed = await processRequest(
        subscriber_id,
        rawUserIdea || '',
        rawReelUrl,
        explicitMode as GenerationMode | undefined,
        tone_hint || undefined,
        language_hint || undefined
      );
    } catch (error: any) {
      if (error.message === 'NO_REEL_PROVIDED') {
        // Send friendly prompt
        try {
          await sendTextMessage(
            subscriber_id,
            "👋 Hey! Send me an Instagram reel and I'll remix it into your style!\n\n" +
            "You can:\n" +
            "• Just send a reel link + \"generate\" for instant magic ✨\n" +
            "• Send a reel + your idea for custom scripts\n" +
            "• Say \"another\" to get a fresh variation"
          );
        } catch (e) {
          logger.warn('Failed to send prompt message', e);
        }
        
        recordRequest({ flow: 'prompt', status: 'prompted' });
        return res.json({
          status: 'success',
          message: 'Prompted user for reel'
        });
      }
      throw error;
    }
    
    // 3. Handle prompt_idea flow (just store and prompt)
    if (processed.flowType === 'prompt_idea') {
      try {
        await sendTextMessage(
          subscriber_id,
          "🎬 Got it! Now what's your idea?\n\n" +
          "Tell me the vibe you want - or just say \"generate\" and I'll pick something fire 🔥"
        );
      } catch (e) {
        logger.warn('Failed to send idea prompt', e);
      }
      
      recordRequest({ flow: 'prompt_idea', status: 'prompted' });
      return res.json({
        status: 'success',
        message: 'Prompted user for idea'
      });
    }
    
    // 3.5. Copy flow now routes through instant flow with isCopyMode flag
    // (handled in processRequest - no separate handler needed)
    
    // 4. Generate request hash (with variation support)
    const requestHash = generateRequestHashV2(
      subscriber_id,
      processed.reelUrl,
      processed.userIdea,
      processed.variationIndex,
      processed.mode
    );
    
    // 5. Check cache (only for non-variations or v=0)
    if (processed.variationIndex === 0) {
      const cachedScript = await Script.findOne({ requestHash }).lean();
      if (cachedScript) {
        logger.info(`[${requestId}] Cache HIT: ${requestHash}`);
        recordCacheResult(true, 'script');
        recordRequest({ flow: processed.flowType, status: 'cached' });
        recordRequestDuration(Date.now() - startTime, { endpoint: 'generate' });
        
        return res.json({
          status: 'success',
          cached: true,
          message: 'Found your script instantly! ⚡',
          script: cachedScript.scriptText,
          imageUrl: cachedScript.imageUrl || null,
          scriptUrl: cachedScript.scriptUrl || null
        });
      }
      recordCacheResult(false, 'script');
    }
    
    // 6. Check for duplicate in-flight jobs
    const existingJob = await Job.findOne({
      requestHash,
      status: { $in: ['queued', 'processing'] }
    });
    
    if (existingJob) {
      logger.info(`[${requestId}] Job already in queue: ${existingJob.jobId}`);
      return res.json({
        status: 'queued',
        jobId: existingJob.jobId,
        message: 'Your script is already being created! Hold tight 🎬'
      });
    }
    
    // 7. Create job record
    await Job.create({
      jobId: requestId,
      subscriberId: subscriber_id,
      status: 'queued',
      reelUrl: processed.reelUrl,
      userIdea: processed.userIdea,
      requestHash,
      attempts: 0
    });
    
    // 8. Add to queue
    await addScriptJob({
      requestId,
      requestHash,
      subscriberId: subscriber_id,
      reelUrl: processed.reelUrl,
      userIdea: processed.userIdea,
      toneHint: processed.toneHint as any,
      languageHint: processed.languageHint,
      mode: processed.mode,
      isCopyMode: processed.isCopyMode || false
    });
    
    logger.info(`[${requestId}] Job queued - flow: ${processed.flowType}, variation: ${processed.variationIndex}`);
    
    // 9. Record metrics
    recordRequest({ flow: processed.flowType, status: 'queued' });
    recordRequestDuration(Date.now() - startTime, { endpoint: 'generate' });
    
    // 10. Get rate limit status for remaining quota
    const rateLimitStatus = await getUserRateLimitStatus(subscriber_id);
    
    // 11. Build ordinal response message with variation info
    let responseMessage: string;
    const versionNum = processed.variationIndex + 1; // Convert 0-indexed to 1-indexed
    
    if (processed.isVariation) {
      // Ordinal messaging for variations
      if (processed.isSoftLimitReached) {
        // User has generated many variations - suggest trying a new idea
        responseMessage = `🔄 Creating version #${versionNum}...\n\n💡 Tip: You've tried ${processed.totalVariations} variations! For better results, try a fresh idea or new reel.`;
      } else if (versionNum === 2) {
        responseMessage = `🔄 Creating your 2nd version - taking a fresh angle! ✨`;
      } else if (versionNum === 3) {
        responseMessage = `🔄 Version #3 coming up - going a different direction! 🎯`;
      } else if (versionNum === 4) {
        responseMessage = `🔄 Version #4 in progress - exploring new territory! 🚀`;
      } else if (versionNum === 5) {
        responseMessage = `🔄 Version #5 brewing - switching up the style! 🔥`;
      } else {
        responseMessage = `🔄 Creating version #${versionNum} for you!`;
      }
    } else if (processed.isCopyMode) {
      responseMessage = "📝 Copying the exact script from this reel...";
    } else if (processed.flowType === 'instant') {
      responseMessage = "✨ Analyzing your reel... Magic incoming!";
    } else {
      responseMessage = "🎬 Got it! Creating your custom script...";
    }
    
    // 12. Send response with remaining quota info
    res.json({
      status: 'queued',
      jobId: requestId,
      flowType: processed.flowType,
      variationIndex: processed.variationIndex,
      variationNumber: versionNum,
      totalVariations: processed.totalVariations || 1,
      message: responseMessage,
      // Rate limit info for user awareness
      rateLimit: rateLimitStatus ? {
        remaining: rateLimitStatus.remaining,
        limit: rateLimitStatus.limit,
        resetInSeconds: rateLimitStatus.resetInSeconds
      } : undefined
    });
    
  } catch (error: any) {
    logger.error(`[${requestId}] Handler error:`, error);
    recordRequest({ flow: 'unknown', status: 'error' });
    recordRequestDuration(Date.now() - startTime, { endpoint: 'generate' });
    
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again!'
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY HANDLER (for backwards compatibility)
// ═══════════════════════════════════════════════════════════════════════════

export { generateScriptHandler } from './generateScript.legacy';

// ═══════════════════════════════════════════════════════════════════════════
// JOB STATUS HANDLER
// ═══════════════════════════════════════════════════════════════════════════

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
