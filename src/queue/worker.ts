import { Worker, Job as BullJob } from 'bullmq';
import path from 'path';
import { getRedis } from './redis';
import { ScriptJobData, ScriptJobResult, CopyJobData, CopyJobResult, QUEUE_NAME } from './scriptQueue';
import { logger } from '../utils/logger';

// Services
import { downloadReel } from '../services/video/reelDownloader.service';
import { extractAudio } from '../services/video/audioExtractor.service';
import { extractFrames, cleanupFrames } from '../services/video/frameExtractor.service';
import { analyzeVideo, VideoAnalysis } from '../services/video/videoAnalyzer.service';
import { generateScript, generateScriptFromVideo } from '../services/ai/scriptGenerator.service';
import { cleanupFiles, forceCleanupTempDir } from '../services/cleanup.service';
// LEGACY imports removed: sendToManyChat, sendTextMessage - using pull-based delivery via manychatStateService
import { manychatStateService } from '../services/external/manychatState.service';
import { generateScriptImage } from '../utils/imageGenerator';
import { generateCarouselImages, CarouselImages } from '../services/ai/carouselGenerator.service';
import { generateUniquePublicId, buildScriptUrl } from '../api/controllers/viewScript.controller';
import { generateReelHash, normalizeInstagramUrl, generateRequestHashV2 } from '../utils/hash';
import { uploadVideoToS3 } from '../services/external/s3.service';
import { requestCoalescer } from '../services/requestCoalescer';

// FSM for state updates
import { chatbotFSM, ChatbotEvent, ChatbotState } from '../services/chatbot/chatbotStateMachine.service';

// Production hardening
import { withCircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker';
import { memoryGovernor } from '../utils/memoryGovernor';
import { recordJobDuration, recordError, recordGeminiDuration, recordVideoAnalysisDuration } from '../api/routes/metrics.routes';

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

// Job timeout configuration (5 minutes default)
const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS || '300000', 10);

// Memory threshold for job processing (85%)
const MEMORY_THRESHOLD = 0.85;
const MEMORY_DELAY_MS = 5000;

let worker: Worker<any, any> | null = null;

/**
 * Helper to check if operation should be aborted
 */
function checkAborted(signal: AbortSignal, requestId: string): void {
  if (signal.aborted) {
    logger.warn(`[${requestId}] Job timed out after ${JOB_TIMEOUT_MS}ms`);
    throw new JobTimeoutError(requestId, JOB_TIMEOUT_MS);
  }
}

/**
 * Custom error for job timeout
 */
class JobTimeoutError extends Error {
  constructor(requestId: string, timeoutMs: number) {
    super(`Job ${requestId} timed out after ${timeoutMs}ms`);
    this.name = 'JobTimeoutError';
  }
}

/**
 * Format a transcript as a structured script (for COPY/EXTRACT mode)
 * This takes the exact words from the video and formats them with ALL details:
 * - Exact transcript
 * - Camera angles
 * - On-screen captions/text
 * - B-roll descriptions
 * - Visual cues
 */
function formatTranscriptAsScript(transcript: string | null, analysis: VideoAnalysis | null): string {
  const sceneDescriptions = analysis?.sceneDescriptions || [];
  const visualCues = analysis?.visualCues || [];
  const cameraAngles = analysis?.cameraAngles || [];
  const onScreenText = analysis?.onScreenText || [];
  const bRollDescriptions = analysis?.bRollDescriptions || [];

  if (!transcript || transcript.trim() === '') {
    // No speech detected - create a visual-only script with ALL details
    return `📋 EXACT EXTRACTION FROM ORIGINAL REEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔇 TRANSCRIPT: (No speech - visual-only reel)

📸 CAMERA ANGLES:
${cameraAngles.length > 0
        ? cameraAngles.map((angle, i) => `  ${i + 1}. ${angle}`).join('\n')
        : '  • Not specified'}

📝 ON-SCREEN TEXT/CAPTIONS:
${onScreenText.length > 0
        ? onScreenText.map((text, i) => `  ${i + 1}. "${text}"`).join('\n')
        : '  • No on-screen text detected'}

🎬 SCENE-BY-SCENE BREAKDOWN:
${sceneDescriptions.length > 0
        ? sceneDescriptions.map((scene, i) => `  Scene ${i + 1}: ${scene}`).join('\n')
        : visualCues.map((cue, i) => `  Scene ${i + 1}: ${cue}`).join('\n') || '  • Opening shot as shown'}

🎞️ B-ROLL / CUTAWAYS:
${bRollDescriptions.length > 0
        ? bRollDescriptions.map((broll, i) => `  ${i + 1}. ${broll}`).join('\n')
        : '  • No B-roll detected'}

✨ VISUAL ELEMENTS:
${visualCues.map(cue => `  • ${cue}`).join('\n') || '  • No specific visual cues'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 Hook Type: ${analysis?.hookType || 'Visual'}
🎭 Tone: ${analysis?.tone || 'Unknown'}`;
  }

  // Has speech - format with transcript and ALL visual details
  return `📋 EXACT EXTRACTION FROM ORIGINAL REEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💬 TRANSCRIPT (Word-for-Word):
"${transcript}"

📸 CAMERA ANGLES:
${cameraAngles.length > 0
      ? cameraAngles.map((angle, i) => `  ${i + 1}. ${angle}`).join('\n')
      : '  • Talking head / Standard shot'}

📝 ON-SCREEN TEXT/CAPTIONS:
${onScreenText.length > 0
      ? onScreenText.map((text, i) => `  ${i + 1}. "${text}"`).join('\n')
      : '  • No on-screen text detected'}

🎬 SCENE-BY-SCENE BREAKDOWN:
${sceneDescriptions.length > 0
      ? sceneDescriptions.map((scene, i) => `  Scene ${i + 1}: ${scene}`).join('\n')
      : '  • Single continuous shot'}

🎞️ B-ROLL / CUTAWAYS:
${bRollDescriptions.length > 0
      ? bRollDescriptions.map((broll, i) => `  ${i + 1}. ${broll}`).join('\n')
      : '  • No B-roll (talking head only)'}

✨ VISUAL ELEMENTS:
${visualCues.map(cue => `  • ${cue}`).join('\n') || '  • No specific visual cues'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 Hook Type: ${analysis?.hookType || 'Unknown'}
🎭 Tone: ${analysis?.tone || 'Unknown'}
📊 Total Scenes: ${sceneDescriptions.length || 1}
📝 Captions Found: ${onScreenText.length}`;
}

/**
 * Process a copy/download job
 * Downloads video, analyzes it fully, and saves ReelDNA with transcript for future use
 */
async function processCopyJob(job: BullJob<CopyJobData>): Promise<CopyJobResult> {
  const { requestId, subscriberId, reelUrl } = job.data;

  logger.info(`[${requestId}] Starting copy job - downloading and analyzing video`);

  let videoPath: string | null = null;
  let audioPath: string | null = null;
  let frameDir: string | null = null;
  const startTime = Date.now();

  try {
    await job.updateProgress(10);

    // Normalize URL
    const normalizedUrl = normalizeInstagramUrl(reelUrl);
    const reelHash = generateReelHash(normalizedUrl);

    // Check if already downloaded AND analyzed (has transcript)
    const existingDNA = await ReelDNA.findOne({ reelUrlHash: reelHash }).lean();
    if (existingDNA?.analysis?.transcript) {
      logger.info(`[${requestId}] ✅ Video already analyzed with transcript`, {
        hookType: existingDNA.analysis.hookType,
        tone: existingDNA.analysis.tone,
        transcriptLength: existingDNA.analysis.transcript?.length
      });

      return {
        success: true,
        videoUrl: existingDNA.videoUrl,
        reelHash
      };
    }

    await job.updateProgress(15);

    // Download video
    logger.info(`[${requestId}] Downloading video...`);
    videoPath = await downloadReel(reelUrl, requestId);
    await job.updateProgress(30);

    // Extract Frames & Audio for analysis
    // Performance Optimization PRD Section 3.2.1-3.2.2: Using optimized defaults (360p, quality=8, max 8 frames)
    logger.info(`[${requestId}] Extracting frames & audio for analysis...`);
    const framePromise = extractFrames(videoPath, requestId);
    const audioPromise = extractAudio(videoPath, requestId);

    const [frameResult, audioResult] = await Promise.all([
      framePromise,
      audioPromise
    ]);

    const frames = frameResult.frames;
    audioPath = audioResult;
    if (frames.length > 0) frameDir = path.dirname(frames[0]);

    await job.updateProgress(50);

    // Do FULL analysis (this extracts transcript from audio!)
    logger.info(`[${requestId}] Analyzing video (extracting transcript)...`);
    const videoAnalysis = await withCircuitBreaker('gemini', async () => {
      return analyzeVideo({
        frames,
        audioPath,
        includeAudio: true
      });
    });

    await job.updateProgress(75);

    // Save ReelDNA with complete analysis + transcript
    await ReelDNA.findOneAndUpdate(
      { reelUrlHash: reelHash },
      {
        reelUrlHash: reelHash,
        reelUrl: normalizedUrl,
        analysis: videoAnalysis, // Complete analysis with transcript!
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      },
      { upsert: true, new: true }
    );

    logger.info(`[${requestId}] ✅ ReelDNA cached with full analysis`);
    await job.updateProgress(90);

    // Analysis complete - data is cached in ReelDNA
    // No direct message sent - user can request script generation separately
    logger.info(`[${requestId}] Video analysis complete`, {
      hookType: videoAnalysis.hookType,
      tone: videoAnalysis.tone,
      hasTranscript: !!videoAnalysis.transcript,
      visualCues: videoAnalysis.visualCues?.length || 0
    });

    await job.updateProgress(100);

    const totalDuration = Date.now() - startTime;
    logger.info(`[${requestId}] Copy job completed in ${totalDuration}ms`);

    return {
      success: true,
      reelHash
    };

  } catch (error: any) {
    logger.error(`[${requestId}] Copy job failed:`, error);
    // No direct message sent - using pull-based delivery only
    throw error;

  } finally {
    // Cleanup downloaded files
    if (videoPath) {
      cleanupFiles([videoPath, audioPath]);
    }
    if (frameDir) {
      cleanupFrames(frameDir);
    }
  }
}

/**
 * Process a script generation job with timeout protection
 * This is the main worker function that handles all the heavy lifting
 */
async function processJob(job: BullJob<ScriptJobData>): Promise<ScriptJobResult> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), JOB_TIMEOUT_MS);

  try {
    return await processJobWithTimeout(job, abortController.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Actual job processing logic with abort signal support
 */
async function processJobWithTimeout(
  job: BullJob<ScriptJobData>,
  signal: AbortSignal
): Promise<ScriptJobResult> {
  const {
    requestId,
    requestHash,
    subscriberId,
    reelUrl,
    userIdea,
    // NEW: Optional hints
    toneHint,
    languageHint,
    mode,
    isCopyMode, // When true, output transcript as-is formatted as script
    isV2, // When true, use V2 ManyChat field names
    storyFormat // Storytelling format for restyling
  } = job.data;

  logger.info(`[${requestId}] Starting job processing (attempt ${job.attemptsMade + 1})${toneHint ? ` [tone: ${toneHint}]` : ''}${mode === 'hook_only' ? ' [hook only]' : ''}${isCopyMode ? ' [COPY MODE]' : ''}${isV2 ? ' [V2]' : ''}${storyFormat ? ` [format: ${storyFormat}]` : ''}`);

  // Update job status in MongoDB
  await Job.findOneAndUpdate(
    { jobId: requestId },
    {
      status: 'processing',
      startedAt: new Date(),
      attempts: job.attemptsMade + 1
    }
  );

  // Update FSM state to PROCESSING
  // This ensures the FSM is in the correct state to accept PROCESSING_COMPLETE later
  // We use forceState because V2 jobs might bypass the standard conversation flow
  try {
    await chatbotFSM.forceState(subscriberId, ChatbotState.PROCESSING, 'Job started');
    logger.info(`[${requestId}] FSM state forced to PROCESSING`);
  } catch (fsmError: any) {
    // Log warning but don't fail the job - we want to try to process anyway
    logger.warn(`[${requestId}] FSM force state to PROCESSING failed: ${fsmError.message}`);
  }

  // Initialize ManyChat state (set status="Processing" with contextual message)
  // Also passes variation info for custom "Creating version #X..." messages
  const isVariation = job.data.isVariation || false;
  const variationIndex = job.data.variationIndex || 0;
  try {
    await manychatStateService.initializeProcessing(subscriberId, isVariation, variationIndex);
  } catch (initError: any) {
    logger.warn(`[${requestId}] Failed to initialize ManyChat state: ${initError.message}`);
  }

  let videoPath: string | null = null;
  let audioPath: string | null = null;
  let frameDir: string | null = null;
  const startTime = Date.now();

  try {
    // Check abort signal periodically
    checkAborted(signal, requestId);

    // Memory pre-check: Delay job if memory is high
    // See PRD_System_Robustness_t3micro.txt Section 6.4
    const memUsage = process.memoryUsage();
    const memPercent = memUsage.heapUsed / memUsage.heapTotal;
    if (memPercent > MEMORY_THRESHOLD) {
      logger.warn(`[${requestId}] High memory (${Math.round(memPercent * 100)}%), delaying job for ${MEMORY_DELAY_MS}ms`);
      await new Promise(resolve => setTimeout(resolve, MEMORY_DELAY_MS));

      // Check abort after delay
      checkAborted(signal, requestId);
    }

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
    // Find scripts with SAME idea (for variation) AND different ideas (for context)
    let previousScripts: { idea: string; script: string; isSameIdea: boolean }[] = [];
    let previousScriptSummaries: { idea: string; hookSummary: string; angleSummary: string; isSameIdea: boolean }[] = [];
    try {
      const normalizedUrl = normalizeInstagramUrl(reelUrl);

      // Expert Lookup: Find scripts sharing the same normalized URL
      const previousScriptsRaw = await Script.find({
        reelUrl: normalizedUrl
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      // Separate same-idea (for variation avoidance) and different-idea (for context)
      const sameIdeaScripts = previousScriptsRaw.filter(ps =>
        ps.userIdea?.toLowerCase().trim() === userIdea?.toLowerCase().trim()
      );
      const differentIdeaScripts = previousScriptsRaw.filter(ps =>
        ps.userIdea?.toLowerCase().trim() !== userIdea?.toLowerCase().trim()
      );

      // For same-idea scripts (regeneration), extract SUMMARIES to help AI create distinct content
      // We don't pass full scripts - just key hooks/angles to avoid repetition
      previousScriptSummaries = sameIdeaScripts.slice(0, 3).map(ps => {
        const scriptText = ps.scriptText || '';
        // Extract hook line (first SAY: content)
        const hookMatch = scriptText.match(/\[HOOK\][\s\S]*?💬\s*SAY:\s*["']?([^"'\n]+)/i);
        const hookSummary = hookMatch?.[1]?.substring(0, 100) || 'Unknown hook';
        // Extract angle/approach summary
        const bodyMatch = scriptText.match(/\[BODY\][\s\S]*?💬\s*SAY:\s*["']?([^"'\n]+)/i);
        const angleSummary = bodyMatch?.[1]?.substring(0, 80) || 'Unknown angle';

        return {
          idea: ps.userIdea,
          hookSummary,
          angleSummary,
          isSameIdea: true
        };
      });

      // For different-idea scripts (context learning), keep full scripts
      previousScripts = differentIdeaScripts.slice(0, 2).map(ps => ({
        idea: ps.userIdea,
        script: ps.scriptText,
        isSameIdea: false
      }));

      if (previousScriptSummaries.length > 0) {
        logger.info(`[${requestId}] Found ${previousScriptSummaries.length} previous variations (will avoid similar hooks/angles)`);
      }
      if (previousScripts.length > 0) {
        logger.info(`[${requestId}] Found ${previousScripts.length} different-idea scripts for context learning`);
      }
    } catch (contextError: any) {
      // Expert Error Handling: Don't fail generation just because history lookup failed
      logger.warn(`[${requestId}] Non-critical: Failed to lookup previous scripts: ${contextError.message}`);
    }

    // ============================================
    // COPY MODE: Output transcript as-is formatted as script
    // ============================================
    if (isCopyMode) {
      logger.info(`[${requestId}] COPY MODE - Will format transcript as script`);

      // We need the transcript, either from cache or by analyzing
      if (cachedDNA?.analysis?.transcript) {
        transcript = cachedDNA.analysis.transcript;
        videoAnalysis = cachedDNA.analysis;
        usedTier1Cache = true;
        logger.info(`[${requestId}] Using cached transcript for copy`);
      } else {
        // Need to download and analyze to get transcript
        logger.info(`[${requestId}] No cached transcript - downloading video for analysis...`);

        videoPath = await downloadReel(reelUrl, requestId);
        await job.updateProgress(25);

        // Performance Optimization PRD: Using optimized defaults (360p, max 8 frames)
        const framePromise = extractFrames(videoPath, requestId);
        const audioPromise = extractAudio(videoPath, requestId);

        const [frameResult, audioResult] = await Promise.all([framePromise, audioPromise]);
        frames = frameResult.frames;
        audioPath = audioResult;
        if (frames.length > 0) frameDir = path.dirname(frames[0]);

        await job.updateProgress(40);

        // Analyze to get transcript
        videoAnalysis = await withCircuitBreaker('gemini', async () => {
          return analyzeVideo({ frames, audioPath, includeAudio: true });
        });

        transcript = videoAnalysis.transcript;

        // Cache the analysis for future use
        await ReelDNA.findOneAndUpdate(
          { reelUrlHash: reelHash },
          {
            reelUrlHash: reelHash,
            reelUrl: normalizeInstagramUrl(reelUrl),
            analysis: videoAnalysis,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          },
          { upsert: true }
        );
      }

      await job.updateProgress(60);

      // Format transcript as a proper script (COPY mode output)
      scriptText = formatTranscriptAsScript(transcript, videoAnalysis);
      scriptGenStartTime = Date.now();

      logger.info(`[${requestId}] Copy mode script generated from transcript`);

    } else if (cachedDNA) {
      // ============================================
      // PATH 1: TIER 1 CACHE HIT (Text-Only Mode)
      // ============================================
      // We have the analysis, simple text generation call (1 Call)
      logger.info(`[${requestId}] ✅ Tier 1 Cache HIT (Reel DNA found) - Using cached analysis`);
      videoAnalysis = cachedDNA.analysis;
      transcript = videoAnalysis.transcript;
      usedTier1Cache = true;
      await job.updateProgress(60);

      // Check abort signal before AI call
      checkAborted(signal, requestId);

      logger.info(`[${requestId}] Generating script (Text Mode)...`);
      scriptGenStartTime = Date.now();

      // Use circuit breaker for Gemini API
      scriptText = await withCircuitBreaker('gemini', async () => {
        return generateScript({
          userIdea,
          transcript,
          visualAnalysis: videoAnalysis,
          toneHint,
          languageHint,
          mode,
          storyFormat, // Storytelling format for restyling
          previousScripts: previousScripts.map(ps => ({ idea: ps.idea, script: ps.script })),
          previousVariationSummaries: previousScriptSummaries
        });
      });

      recordGeminiDuration(Date.now() - scriptGenStartTime);

    } else {
      // ============================================
      // PATH 2: TIER 1 CACHE MISS (One-Shot Mode)
      // ============================================
      // No analysis? Download video and do One-Shot Gen (1 Call)
      // We also do FULL analysis and save to ReelDNA cache

      logger.info(`[${requestId}] Tier 1 Cache MISS - Starting One-Shot Generation...`);

      // Check abort signal before download
      checkAborted(signal, requestId);

      // A. Download video
      logger.info(`[${requestId}] Downloading video...`);
      videoPath = await downloadReel(reelUrl, requestId);
      await job.updateProgress(25);

      // Check abort signal before extraction
      checkAborted(signal, requestId);

      // B. Extract Frames & Audio
      logger.info(`[${requestId}] Extracting frames & audio...`);
      const extractionStartTime = Date.now();

      // Performance Optimization PRD Section 3.2.1-3.2.2: Using optimized defaults
      const framePromise = extractFrames(videoPath, requestId);

      let audioPromise: Promise<string | null> | null = null;
      audioPromise = extractAudio(videoPath, requestId);

      const [frameResult, audioResult] = await Promise.all([
        framePromise,
        audioPromise
      ]);

      frames = frameResult.frames;
      audioPath = audioResult;

      if (frames.length > 0) frameDir = path.dirname(frames[0]);

      logger.info(`[${requestId}] Frames extracted in ${frameResult.extractionTimeMs}ms`);
      recordVideoAnalysisDuration(Date.now() - extractionStartTime);
      await job.updateProgress(40);

      // Check abort signal before AI call
      checkAborted(signal, requestId);

      // C. Generate Script Directly (One-Shot)
      logger.info(`[${requestId}] Generating script (One-Shot Video Mode)...`);
      scriptGenStartTime = Date.now();

      scriptText = await withCircuitBreaker('gemini', async () => {
        return generateScriptFromVideo({
          userIdea,
          frames,
          audioPath,
          transcript: null,
          toneHint,
          languageHint,
          mode,
          storyFormat, // Storytelling format for restyling
          previousScripts: previousScripts.map(ps => ({ idea: ps.idea, script: ps.script })),
          previousVariationSummaries: previousScriptSummaries
        });
      });

      recordGeminiDuration(Date.now() - scriptGenStartTime);

      // D. IMPORTANT: Do full analysis and save to ReelDNA cache
      // This ensures future requests can use cached analysis with transcript
      logger.info(`[${requestId}] Analyzing video for ReelDNA cache...`);
      const analysisStartTime = Date.now();

      videoAnalysis = await withCircuitBreaker('gemini', async () => {
        return analyzeVideo({
          frames,
          audioPath,
          includeAudio: true
        });
      });

      transcript = videoAnalysis.transcript;
      recordVideoAnalysisDuration(Date.now() - analysisStartTime);

      // E. Save ReelDNA for future requests (with complete analysis + transcript!)
      await ReelDNA.findOneAndUpdate(
        { reelUrlHash: reelHash },
        {
          reelUrlHash: reelHash,
          reelUrl: normalizeInstagramUrl(reelUrl),
          analysis: videoAnalysis,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        },
        { upsert: true, new: true }
      );

      logger.info(`[${requestId}] ✅ ReelDNA cached with transcript for future use`);
    }

    const scriptGenTimeMs = Date.now() - scriptGenStartTime;
    await job.updateProgress(75);

    const generationTimeMs = Date.now() - startTime;

    // Check abort signal before image generation
    checkAborted(signal, requestId);

    // D. Generate script images - CAROUSEL for V2, single for V3
    // Carousel provides better UX with swipeable HOOK/BODY/CTA cards
    let imageUrl: string;
    let carouselImages: CarouselImages | null = null;

    if (isV2) {
      // V2: Generate 3-card carousel (reduces system load by parallel generation)
      logger.info(`[${requestId}] Generating carousel images (3 cards)...`);
      try {
        carouselImages = await withCircuitBreaker('cloudinary', async () => {
          return generateCarouselImages(scriptText, job.data.variationIndex || 0);
        });

        // Use hook card as the primary image for backward compatibility
        imageUrl = carouselImages.hookCard;

        logger.info(`[${requestId}] ✅ Carousel generated:`, {
          hookCard: carouselImages.hookCard.substring(0, 50),
          bodyCard: carouselImages.bodyCard.substring(0, 50),
          ctaCard: carouselImages.ctaCard.substring(0, 50)
        });
      } catch (carouselError: any) {
        // Fall back to single image if carousel fails
        logger.warn(`[${requestId}] Carousel generation failed, falling back to single image: ${carouselError.message}`);
        imageUrl = await withCircuitBreaker('cloudinary', async () => {
          return generateScriptImage(scriptText);
        });
        carouselImages = null;
      }
    } else {
      // V3: Generate single combined image
      logger.info(`[${requestId}] Generating script image (single)...`);
      imageUrl = await withCircuitBreaker('cloudinary', async () => {
        return generateScriptImage(scriptText);
      });
    }

    // VALIDATION: Ensure imageUrl is valid before proceeding
    if (!imageUrl || !imageUrl.startsWith('http')) {
      logger.error(`[${requestId}] ❌ CRITICAL: Image generation returned invalid URL`, {
        imageUrl,
        imageUrlType: typeof imageUrl
      });
      throw new Error(`Image generation failed: invalid URL returned (${imageUrl})`);
    }
    logger.info(`[${requestId}] ✅ Image generated: ${imageUrl.substring(0, 80)}...`);
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
        modelVersion: 'gemini-2.5-flash' // 2.5 Flash
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
        analysisModel: usedTier1Cache ? 'gemini-2.5-flash' : 'none',
        scriptModel: 'gemini-2.5-flash',
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

    // Check abort signal before ManyChat
    checkAborted(signal, requestId);

    // G. LEGACY: sendToManyChat REMOVED to avoid duplicate triggers
    // Pull-based delivery via manychatStateService.setReadyState() is used instead
    // This avoids Meta 24-hour window restrictions and 400 errors

    // H. Update job status in MongoDB
    await Job.findOneAndUpdate(
      { jobId: requestId },
      {
        status: 'completed',
        completedAt: new Date(),
        processingTimeMs: Date.now() - startTime,
        result: { scriptText, imageUrl }
      }
    );

    // I. CRITICAL: Update FSM state to AWAITING_FEEDBACK and store script metadata
    // This enables COPY and VARIATION intents to work properly
    try {
      const transitionResult = await chatbotFSM.transition(subscriberId, ChatbotEvent.PROCESSING_COMPLETE, {
        scriptUrl,
        imageUrl,
      });

      if (transitionResult.success) {
        // Store script metadata for COPY/VARIATION intents
        await chatbotFSM.updateMetadata(subscriberId, {
          lastScriptUrl: scriptUrl,
          lastScriptId: publicId,
          lastImageUrl: imageUrl,
          lastReelUrl: reelUrl,
          lastUserIdea: userIdea,
        });

        logger.info(`[${requestId}] FSM successfully transitioned to AWAITING_FEEDBACK`);
      } else {
        logger.error(`[${requestId}] FSM transition failed - invalid transition attempted`, {
          subscriberId,
          currentState: transitionResult.previousState,
          event: ChatbotEvent.PROCESSING_COMPLETE,
          error: transitionResult.error?.message
        });
      }
    } catch (fsmError: any) {
      // Non-fatal - script was delivered, but user state is wrong
      // This is CRITICAL - user will be stuck in PROCESSING state
      logger.error(`[${requestId}] CRITICAL: FSM update failed (internal error) - user may be stuck in PROCESSING state`, {
        error: fsmError.message,
        subscriberId
      });
    }

    // ──────────────────────────────────────────────────────────────────
    // PULL-BASED DELIVERY: Update ManyChat custom fields
    // V2: Uses ai_generated_script, script_image, script_copy_link
    // V3: Uses sc_last_script, sc_last_image, sc_copy_url, sc_status
    // ──────────────────────────────────────────────────────────────────
    try {
      // Use V2 method if job was from V2 endpoint
      if (isV2) {
        // Use carousel delivery if carousel images were generated
        if (carouselImages) {
          await manychatStateService.setReadyStateV2WithCarousel(
            subscriberId,
            scriptText,
            carouselImages,
            imageUrl,
            scriptUrl
          );
          logger.info(`[${requestId}] ✅ ManyChat V2 state set with CAROUSEL - 3 images sent`);
        } else {
          await manychatStateService.setReadyStateV2(subscriberId, scriptText, imageUrl, scriptUrl);
          logger.info(`[${requestId}] ✅ ManyChat V2 state set - single image`);
        }
      } else {
        await manychatStateService.setReadyState(subscriberId, scriptText, imageUrl, scriptUrl);
        logger.info(`[${requestId}] ✅ ManyChat state set to Ready - user can pull data`);
      }
    } catch (stateError: any) {
      // Non-fatal - ManyChat automation will still work with the fields that were set
      logger.warn(`[${requestId}] Failed to set ManyChat ready state`, {
        error: stateError.message
      });
    }

    // ──────────────────────────────────────────────────────────────────
    // REQUEST COALESCING: Fan-out results to all waiting users
    // If other users requested the same reel+idea, deliver to them too
    // ──────────────────────────────────────────────────────────────────
    try {
      const requestHash = generateRequestHashV2(
        subscriberId,
        reelUrl,
        userIdea,
        job.data.variationIndex || 0,
        job.data.mode || 'full'
      );

      const fanOutResult = await requestCoalescer.fanOutResults(
        requestHash,
        scriptText,
        imageUrl,
        scriptUrl,
        carouselImages || undefined
      );

      if (fanOutResult.deliveredCount > 0) {
        logger.info(`[${requestId}] ✅ Coalesce fan-out: delivered to ${fanOutResult.deliveredCount} additional users`);
      }
    } catch (fanOutError: any) {
      // Non-fatal - primary user already received their result
      logger.warn(`[${requestId}] Fan-out failed (non-fatal)`, { error: fanOutError.message });
    }

    const totalDuration = Date.now() - startTime;
    recordJobDuration(totalDuration, { status: 'success' });
    logger.info(`[${requestId}] Job completed successfully in ${totalDuration}ms`);
    await job.updateProgress(100);

    return {
      success: true,
      scriptText,
      imageUrl
    };

  } catch (error: any) {
    const totalDuration = Date.now() - startTime;

    // Determine error type for metrics and better error messages
    let errorType = 'unknown';
    let userMessage = '❌ Something went wrong. Please try again!';

    if (error instanceof JobTimeoutError) {
      errorType = 'timeout';
      userMessage = '⏰ The request took too long. Please try again with a shorter reel!';
    } else if (error instanceof CircuitOpenError) {
      errorType = 'circuit_open';
      userMessage = '🔌 Service temporarily unavailable. Our AI is recovering. Please wait 30 seconds and try again!';
      logger.error(`[${requestId}] Circuit breaker OPEN for: ${error.serviceName}. Service is failing.`);
    } else if (error.message?.includes('download') || error.message?.includes('Instagram')) {
      errorType = 'download';
      userMessage = '❌ Couldn\'t download that reel. The link may be invalid, private, or expired. Try another link!';
    } else if (error.message?.includes('yt-dlp') || error.message?.includes('ENOENT')) {
      errorType = 'download_tool';
      userMessage = '🔧 Download tool unavailable. Please contact support or try again later.';
      logger.error(`[${requestId}] CRITICAL: yt-dlp or download tool missing. Check installation!`);
    } else if (error.message?.includes('Gemini') || error.message?.includes('Vertex AI') || error.message?.includes('429')) {
      errorType = 'api';
      userMessage = '🤖 AI service temporarily overloaded. Please wait 30 seconds and try again!';
      logger.error(`[${requestId}] Gemini/Vertex AI error: ${error.message}`);
    } else if (error.message?.includes('ImgBB') || error.message?.includes('Cloudinary') || error.message?.includes('upload')) {
      errorType = 'upload';
      userMessage = '📷 Image upload failed. Please try again!';
    } else if (error.message?.includes('GOOGLE_APPLICATION_CREDENTIALS') || error.message?.includes('credentials')) {
      errorType = 'auth';
      userMessage = '🔐 Authentication error. Please contact support.';
      logger.error(`[${requestId}] CRITICAL: GCP credentials issue. Check GOOGLE_APPLICATION_CREDENTIALS!`);
    } else if (error.message?.includes('MongoDB') || error.message?.includes('database')) {
      errorType = 'database';
      userMessage = '💾 Database error. Please try again in a moment!';
      logger.error(`[${requestId}] Database error: ${error.message}`);
    }

    recordError(errorType);
    recordJobDuration(totalDuration, { status: 'failed' });
    logger.error(`[${requestId}] Job failed (${errorType}): ${error.message}`);

    // Log full stack trace for debugging (only in logs, not sent to DB in production)
    if (process.env.NODE_ENV === 'development') {
      logger.error(`[${requestId}] Stack trace:`, error.stack);
    }

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

    // On final attempt, update FSM state and send error message
    // BullMQ attemptsMade starts at 0, so attempt 2 = attemptsMade 1
    // Job has 3 total attempts (0, 1, 2), so check if attemptsMade >= 1 (second attempt)
    if (job.attemptsMade >= 1) {
      logger.info(`[${requestId}] Final attempt failed (${job.attemptsMade + 1}/3), transitioning to ERROR state`);

      // LEGACY: sendTextMessage REMOVED to avoid duplicate triggers
      // Pull-based delivery via manychatStateService.setErrorState() is used instead

      // CRITICAL: Update FSM state to ERROR so user can start fresh
      try {
        await chatbotFSM.transition(subscriberId, ChatbotEvent.ERROR_OCCURRED, {
          error: error.message,
          errorType,
        });

        // Store error info in metadata
        await chatbotFSM.updateMetadata(subscriberId, {
          lastError: error.message,
          lastErrorType: errorType,
          lastErrorTime: new Date().toISOString()
        });

        logger.info(`[${requestId}] ✅ FSM transitioned to ERROR state - user can retry`);
      } catch (fsmError: any) {
        logger.error(`[${requestId}] CRITICAL: FSM error transition failed - user stuck!`, {
          error: fsmError.message,
          subscriberId
        });
      }

      // ──────────────────────────────────────────────────────────────────
      // PULL-BASED DELIVERY: Set error state in ManyChat custom fields
      // Sets sc_status = "Error", sc_prompt_message with friendly error, and sc_error_code
      // User can "pull" this by typing "Hi" (avoids Meta 24hr window)
      // ──────────────────────────────────────────────────────────────────
      try {
        const friendlyError = manychatStateService.getFriendlyErrorMessage(error, errorType);
        await manychatStateService.setErrorState(subscriberId, friendlyError, errorType);
        logger.info(`[${requestId}] ManyChat error state set - user can pull error message`);
      } catch (stateError: any) {
        // Non-fatal - legacy delivery already attempted via sendTextMessage
        logger.warn(`[${requestId}] Failed to set ManyChat error state`, {
          error: stateError.message
        });
      }

      // ──────────────────────────────────────────────────────────────────
      // COALESCING: Cancel waiting users if this job was coalesced
      // Notifies all waiting subscribers that the job failed
      // ──────────────────────────────────────────────────────────────────
      try {
        const requestHash = generateRequestHashV2(
          subscriberId,
          reelUrl,
          userIdea,
          job.data.variationIndex || 0,
          job.data.mode || 'full'
        );
        await requestCoalescer.cancelCoalesce(requestHash);
      } catch (cancelError: any) {
        logger.warn(`[${requestId}] Failed to cancel coalesce group`, {
          error: cancelError.message
        });
      }
    } else {
      logger.info(`[${requestId}] Job will retry (attempt ${job.attemptsMade + 2}/3)`);
    }

    throw error; // Re-throw to trigger BullMQ retry

  } finally {
    // Cleanup files from this specific job
    cleanupFiles([videoPath, audioPath]);
    if (frameDir) {
      cleanupFrames(frameDir);
    }

    // CRITICAL: Force cleanup of entire temp directory
    // This catches any orphaned files and prevents memory leaks
    // Only deletes files older than 5 minutes to avoid interfering with other jobs
    forceCleanupTempDir();
  }
}

/**
 * Start the BullMQ worker
 * 
 * Concurrency is set to handle multiple jobs simultaneously
 * This is key for handling 100 concurrent users
 */
export function startWorker(): Worker<any, any> {
  if (worker) {
    logger.info('Worker already started, reusing existing instance');
    return worker;
  }

  // Worker concurrency reduced from 5 to 3 for t3.micro memory safety
  // See PRD_System_Robustness_t3micro.txt Section 2.3
  const concurrency = parseInt(process.env.QUEUE_CONCURRENCY || '2', 10);

  worker = new Worker<any, any>(QUEUE_NAME, async (job) => {
    // Route to appropriate processor based on job name
    if (job.name === 'copy') {
      return processCopyJob(job as BullJob<CopyJobData>);
    } else {
      return processJob(job as BullJob<ScriptJobData>);
    }
  }, {
    connection: getRedis(),
    concurrency,
    limiter: {
      max: 10,        // Max 10 jobs
      duration: 60000 // Per minute (prevent API rate limits)
    },
    // Performance Optimization PRD Section 2.2.1: BullMQ Configuration
    // Increased intervals reduce Redis polling by 60% (3000 commands saved per 10 requests)
    // Jobs are still picked up instantly via Pub/Sub - only stalled job checks are affected
    stalledInterval: 120000,  // Default 30000 -> 120000 (4x slower polling, reduces Upstash load)
    lockDuration: 90000,      // Default 30000 -> 90000 (longer locks reduce Redis writes)
    lockRenewTime: 45000,     // Optimized lock renewal (half of lockDuration)
    maxStalledCount: 3,       // Allow jobs to be stalled 3 times before failing
    drainDelay: 10,           // Small delay when draining to prevent busy loops
    skipStalledCheck: false,  // Enable stalled job recovery
  });

  // Log when worker is waiting for jobs (helps debug idle state)
  let idleLogged = false;

  worker.on('ready', () => {
    logger.info(`✅ BullMQ Worker ready (concurrency: ${concurrency})`);
    idleLogged = false;
  });

  worker.on('active', (job) => {
    logger.info(`Worker: Job ${job.id} started processing`);
    idleLogged = false;
  });

  worker.on('progress', (job, progress) => {
    logger.debug(`Worker: Job ${job.id} progress: ${progress}%`);
  });

  worker.on('completed', (job) => {
    logger.info(`Worker: Job ${job.id} completed`);
    // Proactive Memory Cleanup after every job
    if (global.gc) {
      setImmediate(() => {
        try { global.gc!(); } catch (e) { /* ignore */ }
      });
    }
  });

  worker.on('failed', (job, error) => {
    // Proactive Memory Cleanup after failure
    if (global.gc) {
      setImmediate(() => {
        try { global.gc!(); } catch (e) { /* ignore */ }
      });
    }
    // Don't log timeout errors as critical - they're expected during idle
    if (error.message && error.message.includes('Command timed out')) {
      if (!idleLogged) {
        logger.debug('Worker: Idle (Redis poll timeout - this is normal)');
        idleLogged = true;
      }
      return;
    }
    logger.error(`Worker: Job ${job?.id} failed:`, error.message);
    logger.error(`Worker: Full error:`, error);
  });

  worker.on('error', (error) => {
    // Suppress timeout errors during idle polling
    if (error.message && error.message.includes('Command timed out')) {
      if (!idleLogged) {
        logger.debug('Worker: Connection timeout during idle poll (normal)');
        idleLogged = true;
      }
      return;
    }
    logger.error('Worker error:', error.message);
  });

  worker.on('stalled', (jobId) => {
    logger.warn(`Worker: Job ${jobId} stalled (will be retried)`);
  });

  logger.info(`Worker created for queue: ${QUEUE_NAME}`);

  // Register worker with Memory Governor for dynamic concurrency control
  memoryGovernor.setWorker(worker);

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
  } else {
    logger.info('Worker already stopped or not started');
  }
}

export { worker };
