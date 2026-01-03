import { Worker, Job as BullJob } from 'bullmq';
import path from 'path';
import { getRedis } from './redis';
import { ScriptJobData, ScriptJobResult, CopyJobData, CopyJobResult, QUEUE_NAME } from './scriptQueue';
import { logger } from '../utils/logger';

// Services
import { downloadReel } from '../services/reelDownloader';
import { extractAudio } from '../services/audioExtractor';
import { extractFrames, cleanupFrames } from '../services/frameExtractor';
import { analyzeVideo, VideoAnalysis } from '../services/videoAnalyzer';
import { generateScript, generateScriptFromVideo } from '../services/scriptGenerator';
import { cleanupFiles } from '../services/cleanup';
import { sendToManyChat, sendTextMessage } from '../services/manychat';
import { generateScriptImage } from '../utils/imageGenerator';
import { generateUniquePublicId, buildScriptUrl } from '../api/viewScript';
import { generateReelHash, normalizeInstagramUrl } from '../utils/hash';
import { uploadVideoToS3 } from '../services/s3Service';

// Production hardening
import { withCircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker';
import { recordJobDuration, recordError, recordGeminiDuration, recordVideoAnalysisDuration } from '../api/metrics';

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
 * Format a transcript as a structured script (for COPY mode)
 * This takes the exact words from the video and formats them in our script structure
 */
function formatTranscriptAsScript(transcript: string | null, analysis: VideoAnalysis | null): string {
  if (!transcript || transcript.trim() === '') {
    // No speech detected - create a visual-only script
    const visualCues = analysis?.visualCues || [];
    const sceneDescriptions = analysis?.sceneDescriptions || [];
    
    return `[HOOK]
🎬 VISUAL: ${sceneDescriptions[0] || visualCues[0] || 'Opening shot as shown in video'}
💬 SAY: (No speech - this is a visual-only reel)

[BODY]
🎬 VISUAL: ${sceneDescriptions.slice(1, 3).join(' → ') || visualCues.slice(1, 3).join(', ') || 'Main content visuals as shown'}
💬 SAY: (No speech detected in original)

[CTA]
🎬 VISUAL: ${sceneDescriptions[sceneDescriptions.length - 1] || 'Final shot as shown'}
💬 SAY: (No speech - visual ending)

---
📝 Note: This reel has no spoken dialogue. The visuals carry the message.
🎯 Hook Type: ${analysis?.hookType || 'Visual'}
🎭 Tone: ${analysis?.tone || 'Unknown'}`;
  }
  
  // Split transcript into sentences for better formatting
  const sentences = transcript
    .replace(/([.!?])\s+/g, '$1|')
    .split('|')
    .filter(s => s.trim());
  
  const totalSentences = sentences.length;
  
  // Distribute sentences across hook, body, cta
  let hookSentences: string[];
  let bodySentences: string[];
  let ctaSentences: string[];
  
  if (totalSentences <= 3) {
    hookSentences = sentences.slice(0, 1);
    bodySentences = sentences.slice(1, totalSentences - 1) || [];
    ctaSentences = sentences.slice(-1);
  } else {
    // First ~20% for hook, last ~20% for CTA, rest for body
    const hookCount = Math.max(1, Math.ceil(totalSentences * 0.2));
    const ctaCount = Math.max(1, Math.ceil(totalSentences * 0.2));
    
    hookSentences = sentences.slice(0, hookCount);
    ctaSentences = sentences.slice(-ctaCount);
    bodySentences = sentences.slice(hookCount, -ctaCount);
  }
  
  // Build visual descriptions from analysis
  const sceneDescriptions = analysis?.sceneDescriptions || [];
  const visualCues = analysis?.visualCues || [];
  
  const hookVisual = sceneDescriptions[0] || visualCues[0] || 'Opening shot';
  const bodyVisual = sceneDescriptions.length > 2 
    ? sceneDescriptions.slice(1, -1).join(' → ') 
    : visualCues.slice(1, -1).join(', ') || 'Main content visuals';
  const ctaVisual = sceneDescriptions[sceneDescriptions.length - 1] || visualCues[visualCues.length - 1] || 'Closing shot';
  
  return `[HOOK]
🎬 VISUAL: ${hookVisual}
💬 SAY: "${hookSentences.join(' ')}"

[BODY]
🎬 VISUAL: ${bodyVisual}
💬 SAY: "${bodySentences.join(' ') || '(No additional dialogue)'}"

[CTA]
🎬 VISUAL: ${ctaVisual}
💬 SAY: "${ctaSentences.join(' ')}"

---
📝 EXACT COPY from original reel
🎯 Hook Type: ${analysis?.hookType || 'Unknown'}
🎭 Tone: ${analysis?.tone || 'Unknown'}
📊 Visual Cues: ${visualCues.length} detected`;
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
      logger.info(`[${requestId}] ✅ Video already analyzed with transcript`);
      
      // Send success message with analysis info
      const analysisInfo = existingDNA.analysis;
      await sendTextMessage(
        subscriberId,
        `✅ Video already analyzed!\n\n` +
        `🎯 Hook Type: ${analysisInfo.hookType || 'Unknown'}\n` +
        `🎭 Tone: ${analysisInfo.tone || 'Unknown'}\n` +
        `📝 Transcript: ${analysisInfo.transcript ? 'Available (' + analysisInfo.transcript.slice(0, 50) + '...)' : 'None'}\n\n` +
        `Say "generate" to create a script from it!`
      );
      
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
    logger.info(`[${requestId}] Extracting frames & audio for analysis...`);
    const framePromise = extractFrames(videoPath, requestId, {
      quality: 5,
      width: 480
    });
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

    // Send success message to user with analysis details
    await sendTextMessage(
      subscriberId,
      `✅ Video analyzed and ready!\n\n` +
      `🎯 Hook Type: ${videoAnalysis.hookType || 'Unknown'}\n` +
      `🎭 Tone: ${videoAnalysis.tone || 'Unknown'}\n` +
      `📝 Transcript: ${videoAnalysis.transcript ? 'Extracted (' + videoAnalysis.transcript.slice(0, 50) + '...)' : 'No speech detected'}\n` +
      `👁️ Visual Cues: ${videoAnalysis.visualCues?.length || 0} detected\n\n` +
      `Now say "generate" to create a script, or send me your idea!`
    );

    await job.updateProgress(100);

    const totalDuration = Date.now() - startTime;
    logger.info(`[${requestId}] Copy job completed in ${totalDuration}ms`);

    return {
      success: true,
      reelHash
    };

  } catch (error: any) {
    logger.error(`[${requestId}] Copy job failed:`, error);

    // Send error message to user
    try {
      await sendTextMessage(
        subscriberId,
        `❌ Failed to analyze video: ${error.message}\n\nPlease try again or send a different reel!`
      );
    } catch (e) {
      logger.warn('Failed to send error message', e);
    }

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
    isCopyMode // When true, output transcript as-is formatted as script
  } = job.data;
  
  logger.info(`[${requestId}] Starting job processing (attempt ${job.attemptsMade + 1})${toneHint ? ` [tone: ${toneHint}]` : ''}${mode === 'hook_only' ? ' [hook only]' : ''}${isCopyMode ? ' [COPY MODE]' : ''}`);
  
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
    // Check abort signal periodically
    checkAborted(signal, requestId);
    
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
        
        const framePromise = extractFrames(videoPath, requestId, { quality: 5, width: 480 });
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
      
      const framePromise = extractFrames(videoPath, requestId, {
        quality: 5,
        width: 480
      });

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

    // D. Generate script image FIRST (so we can cache the URL)
    logger.info(`[${requestId}] Generating script image...`);
    const imageUrl = await withCircuitBreaker('imgbb', async () => {
      return generateScriptImage(scriptText);
    });
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

    // G. Send to ManyChat (with copy-friendly link)
    await withCircuitBreaker('manychat', async () => {
      return sendToManyChat({
        subscriber_id: subscriberId,
        field_name: 'script_image_url',
        field_value: imageUrl,
        scriptUrl  // NEW: Include copy-friendly URL
      });
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
    
    // Determine error type for metrics
    let errorType = 'unknown';
    if (error instanceof JobTimeoutError) {
      errorType = 'timeout';
    } else if (error instanceof CircuitOpenError) {
      errorType = 'circuit_open';
    } else if (error.message?.includes('download')) {
      errorType = 'download';
    } else if (error.message?.includes('Gemini') || error.message?.includes('API')) {
      errorType = 'api';
    }
    
    recordError(errorType);
    recordJobDuration(totalDuration, { status: 'failed' });
    logger.error(`[${requestId}] Job failed (${errorType}):`, error);

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
export function startWorker(): Worker<any, any> {
  const concurrency = parseInt(process.env.QUEUE_CONCURRENCY || '5', 10);
  
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
