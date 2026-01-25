
import { VertexAI, Part } from '@google-cloud/vertexai';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import fs from 'fs';

// Define the interface for video analysis results
export interface VideoAnalysis {
  transcript: string | null;
  spokenLanguage: string;
  visualCues: string[];
  hookType: string;
  tone: string;
  pacing: string;
  sceneDescriptions: string[];
  cameraAngles: string[];
  onScreenText: string[];
  bRollDescriptions: string[];
  handGestures: string[];
  transitionStyles: string[];
  credibilitySignals: string[];
  emotionalTriggers: string[];
  callToAction: string | null;
  targetAudience: string;
  keyTakeaway: string;
  scriptStructure: string;
}

// Options for the analyzer
interface AnalyzeOptions {
  frames?: string[];
  audioPath?: string | null;
  includeAudio?: boolean;
}

// Model configuration with fallback hierarchy (Vertex AI compatible)
const MODEL_HIERARCHY = [
  'gemini-2.5-flash',     // Primary (2.5 Flash)
  'gemini-2.0-flash-001', // Fallback (2.0 Flash)
];

// Initialize Vertex AI with error handling
let vertexAI: VertexAI | null = null;

try {
  if (!config.GCP_PROJECT_ID) {
    throw new Error('GCP_PROJECT_ID environment variable is not set');
  }

  vertexAI = new VertexAI({
    project: config.GCP_PROJECT_ID,
    location: config.GCP_LOCATION,
    googleAuthOptions: {
      keyFilename: config.GOOGLE_APPLICATION_CREDENTIALS || undefined,
    },
  });

  logger.info(`✅ Vertex AI initialized for project: ${config.GCP_PROJECT_ID}`);
  if (config.GOOGLE_APPLICATION_CREDENTIALS) {
    logger.info(`✅ Using credentials from: ${config.GOOGLE_APPLICATION_CREDENTIALS}`);
  }
} catch (error: any) {
  logger.error(`❌ Failed to initialize Vertex AI: ${error.message}`);
  logger.error('⚠️  Video analysis features will not be available');
  logger.error('⚠️  Please set GCP_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS environment variables');
  vertexAI = null;
}



/**
 * File to GenerativePart converter (Async)
 */
async function fileToGenerativePart(path: string, mimeType: string): Promise<Part> {
  const data = await fs.promises.readFile(path);
  return {
    inlineData: {
      data: data.toString('base64'),
      mimeType
    },
  };
}

/**
 * Sleep helper for backoff
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Analyze video frames and/or audio using Gemini with fallback support
 */
export async function analyzeVideo(options: AnalyzeOptions): Promise<VideoAnalysis> {
  // Check if Vertex AI is available
  if (!vertexAI) {
    throw new Error('Vertex AI is not initialized. Please configure GCP_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS environment variables.');
  }

  const { frames = [], audioPath, includeAudio } = options;

  // Input validation
  if (frames.length === 0 && !audioPath) {
    throw new Error('No input provided for analysis (frames or audio)');
  }

  // Optimize: Read files into memory ONCE to avoid repeated I/O in the loop
  const frameParts: Part[] = [];

  // Read frames in parallel
  if (frames.length > 0) {
    const framePromises = frames
      .filter(f => fs.existsSync(f))
      .map(f => fileToGenerativePart(f, 'image/jpeg'));

    frameParts.push(...await Promise.all(framePromises));
  }

  // Read audio
  let audioPart: Part | null = null;
  if (includeAudio && audioPath && fs.existsSync(audioPath)) {
    audioPart = await fileToGenerativePart(audioPath, 'audio/wav');
  }

  // Prepare prompt - Enhanced for complete extraction (V2.0 System Prompts)
  const prompt = `
  You are analyzeing a video to extract detailed information for script generation.

  Watch the video carefully and extract EVERYTHING into JSON format.

  RETURN ONLY JSON - NO OTHER TEXT:

  {
    "transcript": "Every word spoken in the video, exactly as said. Include um, uh, like. If no audio or unclear, put null.",
    
    "spokenLanguage": "What language are they SPEAKING (not caption language). Examples: English, Hindi, Spanish, Hinglish, Arabic",
    
    "visualCues": [
      "List everything you SEE in order",
      "Include: props, clothes, background, graphics, animations",
      "Note the style: clean/messy/professional/casual/meme-heavy"
    ],
    
    "hookType": "What hook style is used? Choose ONE: Shock stat, Pattern interrupt, Loss aversion, Insider secret, Urgent warning, Identity call-out, Myth buster, Transformation tease, Story cold open, Question hook, Greeting (weak), Unknown",
    
    "tone": "What's the overall energy? Choose ONE: High-energy, Educational-calm, Sarcastic-edgy, Motivational-intense, Casual-friendly, Professional-authoritative, Vulnerable-personal, Humorous-playful",
    
    "pacing": "How fast do they talk? Choose ONE: Fast-punchy (quick cuts, high energy), Moderate-clear (normal conversation), Slow-deliberate (emphasis on every word), Variable (mix of speeds)",
    
    "sceneDescriptions": [
      "Scene 1 (0-5s): What's shown",
      "Scene 2 (6-10s): Next visual",
      "Continue for all scenes"
    ],
    
    "cameraAngles": [
      "List every camera angle used in order",
      "Examples: Close-up face/eye level, Medium waist-up, Wide shot, Screen recording, POV angle, B-roll cutaway"
    ],
    
    "onScreenText": [
      "Every text/caption shown on screen, in order",
      "Include: subtitles, titles, labels, meme text, any written words",
      "Note when text appears if important"
    ],
    
    "bRollDescriptions": [
      "Any footage that's NOT the person talking",
      "Examples: Stock footage of [X], Screen recording of [Y], Meme showing [Z], Animation of [W]"
    ],
    
    "handGestures": [
      "Important hand movements",
      "Examples: Pointing at camera, Counting on fingers, Open palms, Arms crossed, Waving"
    ],
    
    "transitionStyles": [
      "How scenes connect",
      "Examples: Jump cuts, Smooth fades, Zoom transitions, Swipe effects, Hard cuts"
    ],
    
    "credibilitySignals": [
      "What makes them trustworthy?",
      "Examples: Shows stats/data, Shares personal results (100K in 6 months), References authority (I worked with X), Shows proof (screenshots), Has credentials"
    ],
    
    "emotionalTriggers": [
      "What emotions are created?",
      "Examples: FOMO (fear of missing out), Fear of failure, Hope for change, Curiosity, Feeling validated, Anger at injustice, Shock/surprise"
    ],
    
    "callToAction": "What action do they ask for at the end? Examples: Follow, Like, Share, Comment, Try this, Save this, Buy this, Click link, null if none",
    
    "targetAudience": "Who is this for? Be specific. Examples: Small business owners, Fitness beginners, Broke college students, New creators under 10K, Parents of toddlers",
    
    "keyTakeaway": "The ONE main point of the video in 10 words or less",
    
    "scriptStructure": "How is it organized? Examples: Problem-Solution, Myth-Truth, Story-Lesson, Hook-Value-CTA, List (3 tips), Before-After, Question-Answer"
  }

  Be extremely detailed and accurate. This data will be used to create new scripts.
  `;

  let lastError: any = null;

  // Try models in sequence
  for (const modelName of MODEL_HIERARCHY) {
    try {
      logger.info(`Attempting video analysis with model: ${modelName}`);
      const model = vertexAI.getGenerativeModel({ model: modelName });

      // Prepare parts for Vertex AI format
      const contentParts: Part[] = [
        { text: prompt },
        ...frameParts,
      ];

      if (audioPart) {
        contentParts.push(audioPart);
      }

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: contentParts }],
      });
      const response = result.response;
      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Parse JSON
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}') + 1;
      if (jsonStart === -1 || jsonEnd === 0) {
        throw new Error('Invalid JSON response from Gemini');
      }

      const jsonStr = text.substring(jsonStart, jsonEnd);
      const data = JSON.parse(jsonStr) as VideoAnalysis;

      logger.info(`✅ Analysis successful with ${modelName}`);
      return data;

    } catch (error: any) {
      lastError = error;
      const isAuthError = error.message?.includes('403') || error.status === 403;
      const isRateLimit = error.message?.includes('429') || error.status === 429;
      const isServerError = error.message?.includes('500') || error.status === 500;

      logger.warn(`❌ Model ${modelName} failed: ${error.message}`);

      if (isAuthError) {
        // If auth error, retrying might not help unless we switch API usage pattern (or it's a permission issue with specific model)
        // We continue to next model in case it's a model-access issue.
        logger.warn(`Auth error on ${modelName}, trying next model...`);
      } else if (isRateLimit) {
        // Exponential backoff could be applied here, or just switch to cheaper model
        logger.warn(`Rate limit on ${modelName}, switching to fallback...`);
        await sleep(2000); // Short wait before next model
      } else if (isServerError) {
        logger.warn(`Server error on ${modelName}, switching to fallback...`);
      }

      // Continue loop to next model
    }
  }

  // If we get here, all models failed
  logger.error('All analysis models failed.');
  throw lastError || new Error('Video analysis failed on all models');
}
