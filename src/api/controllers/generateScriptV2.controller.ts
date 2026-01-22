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
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { scriptGenerationSchema } from '../../validators/requestValidator';
import { normalizeInstagramUrl, generateRequestHashV2 } from '../../utils/hash';
import { sessionManager } from '../../services/chatbot/sessionManager.service';

// Queue System (V3-style)
import { addScriptJob, canAcceptJob, ScriptJobData, StoryFormat } from '../../queue';

// Preference Extraction (extracts language/tone from user's idea)
import { extractPreferencesFromIdea, mergePreferences } from '../../utils/preferenceExtractor';
import { Job } from '../../db/models';

/**
 * Parse user_idea to detect special commands from ManyChat
 * 
 * Handles these ManyChat webhook payloads:
 * 1. FORMAT_RESTYLE (with storyFormat) - for story/edgy/tutorial restyling
 * 2. extract/transcript/original - for transcript extraction
 * 3. remix shorter/longer - for remix with transformation
 * 4. remix (custom) - for custom remix prompt
 * 5. Regular idea - for new script generation
 */
interface ParsedUserIdea {
  isExtract: boolean;           // Extract transcript mode
  isRemix: boolean;             // Remix mode (shorter/longer/custom)
  isFormatRestyle: boolean;     // Story format restyling mode
  remixType?: 'shorter' | 'longer' | 'custom';
  cleanIdea: string;            // Cleaned idea for AI (or remix instruction)
  needsStoredIdea: boolean;     // Whether we need to fetch stored idea from session
}

function parseUserIdea(userIdea: string): ParsedUserIdea {
  const lowerIdea = userIdea.toLowerCase().trim();

  // 1. FORMAT_RESTYLE - Used by Story/Edgy/Tutorial buttons
  // When user clicks format button, ManyChat sends user_idea: "FORMAT_RESTYLE"
  // The actual format is in storyFormat field (handled separately)
  if (lowerIdea === 'format_restyle') {
    return {
      isExtract: false,
      isRemix: false,
      isFormatRestyle: true,
      cleanIdea: userIdea,
      needsStoredIdea: true  // Need to fetch stored idea for format restyling
    };
  }

  // 2. Extract mode keywords
  if (['extract', 'transcript', 'verbatim', 'raw', 'original', 'captions'].some(k => lowerIdea === k || lowerIdea.startsWith(k + ' '))) {
    return {
      isExtract: true,
      isRemix: false,
      isFormatRestyle: false,
      cleanIdea: userIdea,
      needsStoredIdea: false
    };
  }

  // 3. Remix shorter - ManyChat sends "remix shorter"
  if (lowerIdea === 'remix shorter' || lowerIdea === 'shorter') {
    return {
      isExtract: false,
      isRemix: true,
      isFormatRestyle: false,
      remixType: 'shorter',
      cleanIdea: '[REMIX: SHORTER] Make it MUCH shorter and punchier. Cut to 15-20 seconds. Remove all filler. Keep only the most impactful points.',
      needsStoredIdea: true  // Need stored idea to know what to remix
    };
  }

  // 4. Remix longer - ManyChat might send "remix longer" in user_message or user_idea
  if (lowerIdea === 'remix longer' || lowerIdea === 'longer') {
    return {
      isExtract: false,
      isRemix: true,
      isFormatRestyle: false,
      remixType: 'longer',
      cleanIdea: '[REMIX: LONGER] Expand with more detail and depth. Add a third insight. Include more examples. Target 40-50 seconds.',
      needsStoredIdea: true  // Need stored idea to know what to remix
    };
  }

  // 5. Custom remix - User might say "remix funnier" or just "remix"
  if (lowerIdea.startsWith('remix')) {
    const customInstruction = userIdea.replace(/remix/gi, '').trim();
    return {
      isExtract: false,
      isRemix: true,
      isFormatRestyle: false,
      remixType: 'custom',
      cleanIdea: customInstruction
        ? `[REMIX: CUSTOM] ${customInstruction}`
        : '[REMIX] Create a fresh version with a different angle or approach.',
      needsStoredIdea: true  // Need stored idea to know what to remix
    };
  }

  // 6. Regular idea - Just a normal script generation request
  return {
    isExtract: false,
    isRemix: false,
    isFormatRestyle: false,
    cleanIdea: userIdea,
    needsStoredIdea: false
  };
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
      tone_hint: initialToneHint,
      language_hint: initialLanguageHint,
      mode
    } = parseResult.data;

    // Mutable versions that can be updated by preference extraction
    let effectiveToneHint = initialToneHint;
    let effectiveLanguageHint = initialLanguageHint;

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
    // PRIORITY: 1) Request body (ManyChat field), 2) Redis session cache
    let normalizedUrl: string | null = null;
    let reelSource: 'request' | 'session' | null = null;

    // Source 1: From request body (ManyChat sends user_reel/reel_url)
    if (reel_url) {
      normalizedUrl = normalizeInstagramUrl(reel_url);
      reelSource = 'request';
      logger.info(`[V2:${requestId}] Reel URL from request body`, {
        urlPreview: normalizedUrl.substring(0, 60)
      });

      // PERSISTENCE: Save Reel URL to session for future context
      if (subscriber_id) {
        await sessionManager.setReelUrl(subscriber_id, normalizedUrl);
      }
    }

    // Source 2: Fallback to session cache (for More Options: Extract/Remix/Story)
    if (!normalizedUrl && subscriber_id) {
      const session = await sessionManager.getSession(subscriber_id);
      if (session?.lastReelUrl) {
        normalizedUrl = session.lastReelUrl;
        reelSource = 'session';
        logger.info(`[V2:${requestId}] Reel URL from session cache (fallback)`, {
          urlPreview: normalizedUrl.substring(0, 60),
          sessionAge: session.lastActivityAt
        });
      }
    }

    // Final check: If no reel URL found from any source, return user-friendly error
    if (!normalizedUrl) {
      logger.warn(`[V2:${requestId}] No reel URL found in request or session`, {
        subscriberId: subscriber_id,
        hasUserIdea: !!user_idea
      });
      res.status(400).json({
        success: false,
        message: '📹 Please send a Reel link first!',
        code: 'MISSING_REEL_URL',
        hint: 'Send an Instagram Reel link to get started'
      });
      return;
    }

    logger.info(`[V2:${requestId}] Reel URL resolved`, {
      source: reelSource,
      urlPreview: normalizedUrl.substring(0, 50)
    });

    // 4. Parse user_idea for special commands (FORMAT_RESTYLE, extract, remix, etc.)
    const parsed = parseUserIdea(user_idea || '');
    const isCopyMode = parsed.isExtract;

    // 4.5 Fetch stored idea from session if needed (for remix/format restyle)
    // These operations need the ORIGINAL idea to modify it
    let storedIdea: string | null = null;
    if (parsed.needsStoredIdea && subscriber_id) {
      const session = await sessionManager.getSession(subscriber_id);
      storedIdea = session?.lastUserIdea || null;

      if (storedIdea) {
        logger.info(`[V2:${requestId}] Fetched stored idea for ${parsed.isRemix ? 'remix' : 'restyle'}`, {
          storedIdea: storedIdea.substring(0, 50),
          operation: parsed.isRemix ? `remix-${parsed.remixType}` : 'format-restyle'
        });
      } else {
        logger.warn(`[V2:${requestId}] No stored idea found for ${parsed.isRemix ? 'remix' : 'restyle'}`, {
          subscriberId: subscriber_id
        });
      }
    }

    // 5. Build final user idea based on operation type
    let finalUserIdea: string;
    let isVariation = false;
    let variationIndex = 0;

    if (parsed.isFormatRestyle) {
      // FORMAT_RESTYLE: Use stored idea with the new story format
      // The storyFormat field tells worker which structure to use
      finalUserIdea = storedIdea || 'Generate a fresh script';
      isVariation = true;
      variationIndex = 1;

      logger.info(`[V2:${requestId}] FORMAT_RESTYLE mode`, {
        storyFormat,
        originalIdea: finalUserIdea.substring(0, 50)
      });

    } else if (parsed.isRemix) {
      // REMIX: Combine remix instruction with original idea
      // e.g., "[REMIX: SHORTER] Make it MUCH shorter... Original topic: Coffee tips"
      const originalIdea = storedIdea || 'the same topic';
      finalUserIdea = `${parsed.cleanIdea}\n\nOriginal topic: ${originalIdea}`;
      isVariation = true;
      variationIndex = 1;

      logger.info(`[V2:${requestId}] REMIX mode: ${parsed.remixType}`, {
        remixInstruction: parsed.cleanIdea.substring(0, 80),
        originalIdea: originalIdea.substring(0, 50)
      });

    } else if (parsed.isExtract) {
      // EXTRACT: Just use the extract command
      finalUserIdea = '[EXTRACT ORIGINAL TRANSCRIPT]';

      logger.info(`[V2:${requestId}] EXTRACT mode`);

    } else {
      // REGULAR: Normal idea - apply preference extraction
      const extractedPrefs = extractPreferencesFromIdea(parsed.cleanIdea || user_idea || '');

      // Merge preferences: User's explicit request (from idea) > ManyChat field > Default
      const { finalToneHint: extractedTone, finalLanguageHint: extractedLang, finalIdea } = mergePreferences(
        extractedPrefs,
        effectiveToneHint,
        effectiveLanguageHint
      );

      // Update hints from extracted preferences
      if (extractedTone) effectiveToneHint = extractedTone;
      if (extractedLang) effectiveLanguageHint = extractedLang;

      finalUserIdea = finalIdea || parsed.cleanIdea || user_idea || '';

      // PERSISTENCE: Save this new idea for future Remix/Restyle
      if (subscriber_id) {
        await sessionManager.setUserIdea(subscriber_id, finalUserIdea);
      }

      if (extractedPrefs.hasExplicitPreferences) {
        logger.info(`[V2:${requestId}] Preferences extracted from idea`, {
          tone: extractedTone,
          language: extractedLang,
          cleanedIdea: finalUserIdea.substring(0, 50)
        });
      }
    }

    // 6. Generate request hash for deduplication
    // Include storyFormat and remix type to ensure unique hash for variations
    const hashSuffix = storyFormat || (parsed.isRemix ? `remix-${parsed.remixType}` : '');
    const requestHash = generateRequestHashV2(subscriber_id, normalizedUrl, finalUserIdea + hashSuffix);

    // 7. Create job record in MongoDB (for tracking)
    await Job.create({
      jobId: requestId,
      subscriberId: subscriber_id,
      status: 'queued',
      reelUrl: normalizedUrl,
      userIdea: finalUserIdea,
      requestHash,
      createdAt: new Date()
    });

    // 8. Queue the job to BullMQ (processed by worker with concurrency control)
    const jobData: ScriptJobData = {
      requestId,
      requestHash,
      subscriberId: subscriber_id,
      reelUrl: normalizedUrl,
      userIdea: finalUserIdea,
      toneHint: effectiveToneHint as ScriptJobData['toneHint'],
      languageHint: effectiveLanguageHint,
      mode: mode as 'full' | 'hook_only',
      isV2: true,
      storyFormat: storyFormat,
      isCopyMode: isCopyMode,
      isVariation: isVariation,
      variationIndex: variationIndex
    };

    await addScriptJob(jobData);

    logger.info(`[V2:${requestId}] Job queued for subscriber ${subscriber_id}`, {
      reelUrl: normalizedUrl.substring(0, 50),
      userIdea: finalUserIdea.substring(0, 80),
      storyFormat: storyFormat || 'default',
      isCopyMode,
      isRemix: parsed.isRemix,
      remixType: parsed.remixType,
      isFormatRestyle: parsed.isFormatRestyle,
      isVariation
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
