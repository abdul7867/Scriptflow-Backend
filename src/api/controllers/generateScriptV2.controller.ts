/**
 * ScriptGeneration Controller (Refactored for "Fire and Forget")
 * 
 * Goals:
 * 1. Receive request -> Immediate 200 OK
 * 2. Async Background: Download -> Analyze -> Generate Script -> Generate Image
 * 3. Update specific ManyChat custom fields
 */

import { Request, Response } from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { scriptGenerationSchema } from '../../validators/requestValidator';
import { normalizeInstagramUrl, generateReelHash } from '../../utils/hash';
import { detectTrigger } from '../../utils/triggerDetector';

// Services
import { downloadReel } from '../../services/video/reelDownloader.service';
import { extractAudio } from '../../services/video/audioExtractor.service';
import { extractFrames, cleanupFrames } from '../../services/video/frameExtractor.service';
import { analyzeVideo, VideoAnalysis } from '../../services/video/videoAnalyzer.service';
import { generateScript, generateScriptFromVideo } from '../../services/ai/scriptGenerator.service';
import { generateScriptImage } from '../../utils/imageGenerator';
import { cleanupFiles } from '../../services/cleanup.service';
import { buildScriptUrl, generateUniquePublicId } from './viewScript.controller';
import { Script, ReelDNA } from '../../db/models';

/**
 * Main Handler: Fire and Forget
 */
export const generateScriptHandlerV2 = async (req: Request, res: Response): Promise<void> => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    // 1. Validate Request
    const parseResult = scriptGenerationSchema.safeParse(req.body);
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

    // 2. IMMEDIATE RESPONSE (The "Fire" part)
    res.status(200).json({ success: true });

    // 3. BACKGROUND TASK (The "Forget" part)
    // We do NOT await this. It runs in the background.
    handleAsyncScriptGeneration({
      requestId,
      subscriberId: subscriber_id,
      reelUrl: reel_url,
      userIdea: user_idea || '',
      toneHint: tone_hint,
      languageHint: language_hint,
      mode: mode as 'full' | 'hook_only'
    }).catch(err => {
      // High-level catch for the background task to prevent silent crashes
      console.error(`[Background Error] Request ${requestId} failed:`, err);
      logger.error(`[Background Error] Request ${requestId} failed`, { error: err });
    });

  } catch (error: any) {
    // Synchronous error handling (before response)
    logger.error(`[Controller:${requestId}] Error processing request`, { error });
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
  }
};

interface AsyncJobData {
  requestId: string;
  subscriberId: string;
  reelUrl?: string;
  userIdea: string;
  toneHint?: string;
  languageHint?: string;
  mode?: 'full' | 'hook_only';
}

/**
 * Background Processor
 */
async function handleAsyncScriptGeneration(data: AsyncJobData) {
  const { requestId, subscriberId, reelUrl, userIdea, toneHint, languageHint, mode } = data;

  // Paths for cleanup
  let videoPath: string | null = null;
  let audioPath: string | null = null;
  let frameDir: string | null = null;
  let frames: string[] = [];

  console.log(`[${requestId}] Starting background generation for subscriber ${subscriberId}...`);

  try {
    if (!reelUrl) throw new Error('No reel URL provided');

    const normalizedUrl = normalizeInstagramUrl(reelUrl);
    const reelHash = generateReelHash(normalizedUrl);

    let scriptText = '';
    let videoAnalysis: VideoAnalysis | null = null;
    let transcript: string | null = null;

    // --- STEP 1: Check Cache (ReelDNA) ---
    const cachedDNA = await ReelDNA.findOne({ reelUrlHash: reelHash }).lean();

    if (cachedDNA?.analysis) {
      console.log(`[${requestId}] Cached Analysis found.`);
      videoAnalysis = cachedDNA.analysis;
      transcript = videoAnalysis.transcript;
    } else {
      console.log(`[${requestId}] Downloading and Analyzing Reel...`);

      // Download
      videoPath = await downloadReel(normalizedUrl, requestId);

      // Extract
      const [frameResult, audioResult] = await Promise.all([
        extractFrames(videoPath, requestId),
        extractAudio(videoPath, requestId)
      ]);

      frames = frameResult.frames;
      audioPath = audioResult;
      if (frames.length > 0) frameDir = path.dirname(frames[0]);

      // Analyze
      videoAnalysis = await analyzeVideo({
        frames,
        audioPath,
        includeAudio: true
      });
      transcript = videoAnalysis.transcript;

      // Save Cache
      await ReelDNA.findOneAndUpdate(
        { reelUrlHash: reelHash },
        {
          reelUrlHash: reelHash,
          reelUrl: normalizedUrl,
          analysis: videoAnalysis,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        },
        { upsert: true, new: true }
      );
    }

    // --- STEP 2: Generate Script ---
    console.log(`[${requestId}] Generating Script with Idea: "${userIdea}"...`);

    // Use generator service
    scriptText = await generateScript({
      userIdea,
      transcript,
      visualAnalysis: videoAnalysis,
      toneHint: toneHint as any,
      languageHint,
      mode
    });

    // --- STEP 3: Generate Image ---
    console.log(`[${requestId}] Generating Image...`);
    const imageUrl = await generateScriptImage(scriptText);

    // --- STEP 4: Persist Script (Optional but good for history) ---
    const publicId = await generateUniquePublicId();
    const scriptUrl = buildScriptUrl(publicId);

    await Script.create({
      publicId,
      manychatUserId: subscriberId,
      reelUrl: normalizedUrl,
      userIdea,
      scriptText,
      imageUrl,
      scriptUrl,
      requestHash: crypto.randomUUID(), // Simplified hash
      modelVersion: 'gemini-2.5-flash'
    });

    // --- STEP 5: Update ManyChat (The Critical Part) ---
    console.log(`[${requestId}] Updating ManyChat...`);
    await updateManyChatFields(subscriberId, scriptText, imageUrl, scriptUrl);

    console.log(`[${requestId}] Process Complete! Success.`);

  } catch (error: any) {
    console.error(`[${requestId}] Background Process Failed:`, error.message);
    // Optional: Update ManyChat with error message? 
    // User didn't strictly ask for it, but good practice.
    // For now, adhering to strict logout.
  } finally {
    // --- Cleanup ---
    if (videoPath) cleanupFiles([videoPath]);
    if (audioPath) cleanupFiles([audioPath]);
    if (frameDir) cleanupFrames(frameDir);
  }
}

/**
 * Updates ManyChat Custom Fields via Axios
 */
async function updateManyChatFields(subscriberId: string, scriptText: string, imageUrl: string, scriptUrl: string) {
  const token = config.MANYCHAT_API_TOKEN || config.MANYCHAT_API_KEY;
  const url = 'https://api.manychat.com/fb/subscriber/setCustomFields';

  // Map to the EXACT fields requested by user using IDs from config
  const fields = [
    {
      field_id: parseInt(config.MANYCHAT_SC_LAST_SCRIPT_FIELD_ID, 10),
      field_value: scriptText
    },
    {
      field_id: parseInt(config.MANYCHAT_SC_LAST_IMAGE_FIELD_ID, 10),
      field_value: imageUrl
    },
    {
      field_id: parseInt(config.MANYCHAT_SC_COPY_URL_FIELD_ID, 10),
      field_value: scriptUrl
    }
  ];

  // Filter out invalid fields (if ID is missing in config)
  const validFields = fields.filter(f => !isNaN(f.field_id) && f.field_id > 0);

  if (validFields.length === 0) {
    console.warn('[ManyChat] No valid field IDs configured. Skipping update.');
    return;
  }

  try {
    await axios.post(url, {
      subscriber_id: parseInt(subscriberId, 10), // ManyChat often expects number
      fields: validFields
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`[ManyChat] Updated ${validFields.length} fields for ${subscriberId}`);
  } catch (error: any) {
    console.error('[ManyChat] API Update Failed:', error.response?.data || error.message);
    throw error;
  }
}

export default {
  generateScriptHandlerV2
};
