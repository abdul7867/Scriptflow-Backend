import { Worker, Job as BullJob } from 'bullmq';
import path from 'path';
import { getRedis } from './redis';
import { ScriptJobData, ScriptJobResult, QUEUE_NAME } from './scriptQueue';
import { logger } from '../utils/logger';

// Services
import { downloadReel } from '../services/reelDownloader';
import { extractAudio } from '../services/audioExtractor';
import { extractFrames, cleanupFrames } from '../services/frameExtractor';
import { analyzeVideo, VideoAnalysis } from '../services/videoAnalyzer';
import { generateScript, generateScriptFromVideo } from '../services/scriptGenerator';
import { cleanupFiles } from '../services/cleanup';
import { sendToManyChat } from '../services/manychat';
import { generateScriptImage } from '../utils/imageGenerator';
import { generateUniquePublicId, buildScriptUrl } from '../api/viewScript';
import { generateReelHash, normalizeInstagramUrl } from '../utils/hash';

// Database
import { Script, Job, ReelDNA } from '../db/models';
import { 
  DatasetEntry, 
  parseScriptSections, 
  extractVisualLines, 
  extractDialogueLines, 
  estimateSpokenDuration,
  countWords
} from '../db/models/Dataset';

// Analysis mode configuration
type AnalysisMode = 'audio' | 'frames' | 'hybrid';
const ANALYSIS_MODE: AnalysisMode = (process.env.ANALYSIS_MODE as AnalysisMode) || 'hybrid';

let worker: Worker<ScriptJobData, ScriptJobResult> | null = null;

/**
 * Process a script generation job
 * This is the main worker function that handles all the heavy lifting
 */
async function processJob(job: BullJob<ScriptJobData>): Promise<ScriptJobResult> {
  const { 
    requestId, 
    requestHash, 
    subscriberId, 
    reelUrl, 
    userIdea,
    // NEW: Optional hints
    toneHint,
    languageHint,
    mode 
  } = job.data;
  
  logger.info(`[${requestId}] Starting job processing (attempt ${job.attemptsMade + 1})${toneHint ? ` [tone: ${toneHint}]` : ''}${mode === 'hook_only' ? ' [hook only]' : ''}`);
  
  // Update job status in MongoDB
  await Job.findOneAndUpdate(
    { jobId: requestId },
    { 
      status: 'processing',
      startedAt: new Date(),
      attempts: job.attemptsMade + 1
    }
  );

  let videoPath: string | null = null;
  let audioPath: string | null = null;
  let frameDir: string | null = null;
  const startTime = Date.now();

  try {
    // Report progress
    await job.updateProgress(10);

    // ==== TIER 1 CACHE CHECK: Reuse video analysis if available ====
    const reelHash = generateReelHash(reelUrl);
    const cachedDNA = await ReelDNA.findOne({ reelUrlHash: reelHash }).lean();
    
    let videoAnalysis: VideoAnalysis | null = null;
    let transcript: string | null = null;
    let frames: string[] = [];
    let usedTier1Cache = false;
    let scriptText = '';
    let scriptGenStartTime = 0;

    // C. Lookup previous scripts for this reel (Expert: learn from history)
    let previousScripts: { idea: string; script: string }[] = [];
    try {
      const normalizedUrl = normalizeInstagramUrl(reelUrl);
      
      // Expert Lookup: Find scripts sharing the same normalized URL
      const previousScriptsRaw = await Script.find({ 
        reelUrl: normalizedUrl 
      })
        .sort({ createdAt: -1 })
        .limit(3)
        .lean();
      
      previousScripts = previousScriptsRaw
        .filter(ps => ps.userIdea !== userIdea) // Don't include same idea
        .map(ps => ({ idea: ps.userIdea, script: ps.scriptText }));
      
      if (previousScripts.length > 0) {
        logger.info(`[${requestId}] Found ${previousScripts.length} previous scripts for context learning`);
      }
    } catch (contextError: any) {
      // Expert Error Handling: Don't fail generation just because history lookup failed
      logger.warn(`[${requestId}] Non-critical: Failed to lookup previous scripts: ${contextError.message}`);
    }

    if (cachedDNA) {
      // ============================================
      // PATH 1: TIER 1 CACHE HIT (Text-Only Mode)
      // ============================================
      // We have the analysis, simple text generation call (1 Call)
      logger.info(`[${requestId}] ✅ Tier 1 Cache HIT (Reel DNA found) - Using cached analysis`);
      videoAnalysis = cachedDNA.analysis;
      transcript = videoAnalysis.transcript;
      usedTier1Cache = true;
      await job.updateProgress(60); 

      logger.info(`[${requestId}] Generating script (Text Mode)...`);
      scriptGenStartTime = Date.now();
      
      scriptText = await generateScript({
        userIdea,
        transcript,
        visualAnalysis: videoAnalysis,
        toneHint,
        languageHint,
        mode,
        previousScripts
      });

    } else {
      // ============================================
      // PATH 2: TIER 1 CACHE MISS (One-Shot Mode)
      // ============================================
      // No analysis? Download video and do One-Shot Gen (1 Call)
      // We SKIP the explicit analyzeVideo step to save costs.
      
      logger.info(`[${requestId}] Tier 1 Cache MISS - Starting One-Shot Generation...`);

      // A. Download video
      logger.info(`[${requestId}] Downloading video...`);
      videoPath = await downloadReel(reelUrl, requestId);
      await job.updateProgress(25);

      // B. Extract Frames & Audio
      logger.info(`[${requestId}] Extracting frames & audio...`);
      
      const framePromise = extractFrames(videoPath, requestId, {
        quality: 5,
        width: 480
      });

      let audioPromise: Promise<string | null> | null = null;
      // Always try to extract audio for One-Shot
      audioPromise = extractAudio(videoPath, requestId);

      const [frameResult, audioResult] = await Promise.all([
        framePromise,
        audioPromise
      ]);

      frames = frameResult.frames;
      audioPath = audioResult;
      
      if (frames.length > 0) frameDir = path.dirname(frames[0]);

      logger.info(`[${requestId}] Frames extracted in ${frameResult.extractionTimeMs}ms`);
      await job.updateProgress(40);

      // C. Generate Script Directly (One-Shot)
      logger.info(`[${requestId}] Generating script (One-Shot Video Mode)...`);
      scriptGenStartTime = Date.now();
      
      scriptText = await generateScriptFromVideo({
        userIdea,
        frames,
        audioPath,
        transcript: null, // Unknown yet
        toneHint,
        languageHint,
        mode,
        previousScripts
      });
      
      // NOTE: We do NOT save ReelDNA here because we skipped the structured analysis step.
      // This is the tradeoff for 50% cost savings.
    }

    const scriptGenTimeMs = Date.now() - scriptGenStartTime;
    await job.updateProgress(75);

    const generationTimeMs = Date.now() - startTime;

    // D. Generate script image FIRST (so we can cache the URL)
    logger.info(`[${requestId}] Generating script image...`);
    const imageUrl = await generateScriptImage(scriptText);
    await job.updateProgress(80);

    // D2. Generate public ID for copy-friendly link (collision-safe)
    const publicId = await generateUniquePublicId();
    const scriptUrl = buildScriptUrl(publicId);
    logger.info(`[${requestId}] Script URL: ${scriptUrl}`);

    // E. Save to MongoDB (Script collection) - including imageUrl and scriptUrl
    await Script.findOneAndUpdate(
      { requestHash },
      {
        requestHash,
        publicId,
        manychatUserId: subscriberId,
        reelUrl,
        userIdea,
        scriptText,
        imageUrl,
        scriptUrl,
        generationTimeMs,
        modelVersion: 'gemini-2.0-flash-001' // or 2.0-flash for one-shot
      },
      { upsert: true, new: true }
    );

    // E. Save to Dataset for ML training (Enhanced schema v2.0)
    // For One-Shot, analysis fields will be empty/undefined.
    const scriptSections = parseScriptSections(scriptText);
    const analysisTimeMs = usedTier1Cache ? 0 : 0; // Effectively 0 separate analysis time
    
    await DatasetEntry.create({
      // INPUT FEATURES
      input: {
        videoUrl: reelUrl,
        userIdea,
        requestHash,
        
        // User preferences (hints)
        toneHint,
        languageHint,
        mode: mode || 'full',
        
        // Video analysis results (May be empty for One-Shot)
        transcript: transcript || undefined,
        transcriptWordCount: countWords(transcript || undefined),
        visualCues: videoAnalysis?.visualCues || [],
        hookType: videoAnalysis?.hookType,
        detectedTone: videoAnalysis?.tone,
        sceneDescriptions: videoAnalysis?.sceneDescriptions || [],
        frameCount: frames?.length || 0
      },
      
      // OUTPUT FEATURES
      output: {
        generatedScript: scriptText,
        scriptSections,
        visualDirections: extractVisualLines(scriptText),
        dialogueLines: extractDialogueLines(scriptText),
        scriptLengthChars: scriptText.length,
        estimatedSpokenDuration: estimateSpokenDuration(scriptText),
        hookLengthChars: scriptSections.hook?.length || 0,
        bodyLengthChars: scriptSections.body?.length || 0,
        ctaLengthChars: scriptSections.cta?.length || 0
      },
      
      // FEEDBACK (defaults, updated later via feedback API)
      feedback: {
        wasAccepted: true,
        sectionFeedback: {
          hook: { wasRegenerated: false },
          body: { wasRegenerated: false },
          cta: { wasRegenerated: false }
        }
      },
      
      // GENERATION METADATA
      generation: {
        analysisModel: usedTier1Cache ? 'gemini-2.0-flash-001' : 'none',
        scriptModel: usedTier1Cache ? 'gemini-2.0-flash-001' : 'gemini-2.0-flash-001',
        analysisTimeMs,
        generationTimeMs: scriptGenTimeMs,
        totalTimeMs: generationTimeMs,
        analysisAttempts: 1,
        generationAttempts: 1,
        promptVersion: 'steal-artist-one-shot-v1.0'
      },
      
      // TRAINING FLAGS
      training: {
        isValidated: false,
        qualityScore: 50, // Default, recomputed on feedback
        includedInTraining: false,
        datasetVersion: '2.0.0',
        schemaVersion: '2.0.0'
      }
    });
    await job.updateProgress(90);

    // G. Send to ManyChat (with copy-friendly link)
    await sendToManyChat({
      subscriber_id: subscriberId,
      field_name: 'script_image_url',
      field_value: imageUrl,
      scriptUrl  // NEW: Include copy-friendly URL
    });

    // G. Update job status
    await Job.findOneAndUpdate(
      { jobId: requestId },
      {
        status: 'completed',
        completedAt: new Date(),
        processingTimeMs: Date.now() - startTime,
        result: { scriptText, imageUrl }
      }
    );

    logger.info(`[${requestId}] Job completed successfully in ${Date.now() - startTime}ms`);
    await job.updateProgress(100);

    return {
      success: true,
      scriptText,
      imageUrl
    };

  } catch (error: any) {
    logger.error(`[${requestId}] Job failed:`, error);

    // Update job status to failed
    // SECURITY: Don't store full stack traces in production (exposes internal paths)
    await Job.findOneAndUpdate(
      { jobId: requestId },
      {
        status: 'failed',
        error: error.message,
        errorStack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
        completedAt: new Date()
      }
    );

    // Send fallback script on final attempt
    if (job.attemptsMade >= 2) {
      const fallbackScript = `I couldn't watch that specific reel, but here is a script based on your idea:
      
[HOOK]
(Start with a strong statement about ${userIdea})

[BODY]
(Explain your main point about ${userIdea})

[CTA]
(Tell them to comment or follow)`;

      try {
        await sendToManyChat({
          subscriber_id: subscriberId,
          field_name: 'AI_Script_Result',
          field_value: fallbackScript
        });
      } catch (manyChatError) {
        logger.error(`[${requestId}] Failed to send fallback:`, manyChatError);
      }
    }

    throw error; // Re-throw to trigger BullMQ retry

  } finally {
    // Cleanup files
    cleanupFiles([videoPath, audioPath]);
    if (frameDir) {
      cleanupFrames(frameDir);
    }
  }
}

/**
 * Start the BullMQ worker
 * 
 * Concurrency is set to handle multiple jobs simultaneously
 * This is key for handling 100 concurrent users
 */
export function startWorker(): Worker<ScriptJobData, ScriptJobResult> {
  const concurrency = parseInt(process.env.QUEUE_CONCURRENCY || '5', 10);
  
  worker = new Worker<ScriptJobData, ScriptJobResult>(QUEUE_NAME, processJob, {
    connection: getRedis(),
    concurrency,
    limiter: {
      max: 10,        // Max 10 jobs
      duration: 60000 // Per minute (prevent API rate limits)
    }
  });

  worker.on('ready', () => {
    logger.info(`✅ BullMQ Worker ready (concurrency: ${concurrency})`);
  });

  worker.on('active', (job) => {
    logger.info(`Worker: Job ${job.id} started processing`);
  });

  worker.on('progress', (job, progress) => {
    logger.info(`Worker: Job ${job.id} progress: ${progress}%`);
  });

  worker.on('completed', (job) => {
    logger.info(`Worker: Job ${job.id} completed`);
  });

  worker.on('failed', (job, error) => {
    logger.error(`Worker: Job ${job?.id} failed:`, error.message);
    logger.error(`Worker: Full error:`, error);
  });

  worker.on('error', (error) => {
    logger.error('Worker error:', error);
  });

  logger.info(`Worker created for queue: ${QUEUE_NAME}`);
  return worker;
}

/**
 * Stop the worker gracefully
 */
export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('BullMQ Worker stopped');
  }
}

export { worker };
