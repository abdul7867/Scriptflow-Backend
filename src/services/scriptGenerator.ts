import { VertexAI, Part } from '@google-cloud/vertexai';
import fs from 'fs';
import { logger } from '../utils/logger';
import { VideoAnalysis } from './videoAnalyzer';
import { config } from '../config';

// Initialize Vertex AI
const vertexAI = new VertexAI({
  project: config.GCP_PROJECT_ID,
  location: config.GCP_LOCATION,
});

/**
 * Helper to convert file to GenerativePart
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

// ============================================
// Types
// ============================================

export type ToneHint = 'professional' | 'funny' | 'provocative' | 'educational' | 'casual';
export type GenerationMode = 'full' | 'hook_only';

export interface ScriptGeneratorOptions {
  userIdea: string;
  transcript: string | null;
  visualAnalysis?: VideoAnalysis | null;
  
  // NEW: Optional hints (work WITH video DNA, not override)
  toneHint?: ToneHint;
  languageHint?: string;
  mode?: GenerationMode;
  
  // NEW: Previous scripts for same reel (for context/learning)
  previousScripts?: { idea: string; script: string }[];
}

export interface OneShotGeneratorOptions extends ScriptGeneratorOptions {
  frames: string[];
  audioPath?: string | null;
}

// ============================================
// Hint Builder (APPENDED to prompt, not replacing)
// ============================================

/**
 * Build optional hints section
 * These are GENTLE suggestions that work WITH the video's DNA
 * The video's original style is ALWAYS primary
 */
function buildOptionalHints(options: ScriptGeneratorOptions): string {
  const hints: string[] = [];
  
  if (options.toneHint) {
    const toneDescriptions: Record<ToneHint, string> = {
      professional: 'business-focused and authoritative',
      funny: 'humorous and witty with clever wordplay',
      provocative: 'edgy and attention-grabbing',
      educational: 'informative and teaching-focused',
      casual: 'friendly and conversational'
    };
    
    hints.push(`
TONE PREFERENCE (subtle adjustment, preserve video's original energy):
The user prefers a "${options.toneHint}" feel (${toneDescriptions[options.toneHint]}). 
Apply this GENTLY while keeping the reference video's authentic style as the PRIMARY influence.
Do NOT completely change the tone - just lean slightly in this direction.`);
  }
  
  if (options.languageHint) {
    hints.push(`
LANGUAGE PREFERENCE (STRICT):
Write ALL spoken dialogue (💬 SAY:) in ${options.languageHint} language.`);
  }
  
  if (options.mode === 'hook_only') {
    hints.push(`
MODE: HOOK ONLY
Generate ONLY the [HOOK] section. Skip [BODY] and [CTA] entirely.
Make the hook extra impactful since it's standalone.
Still follow all other formatting rules for the hook.`);
  }
  
  if (hints.length === 0) return '';
  
  // Always add visual guidance reminder for better shooting instructions
  hints.push(`
VISUAL DIRECTION REMINDER:
For each 🎬 VISUAL: line, be EXTREMELY SPECIFIC about:
- Exact camera angle (e.g., "Close-up face shot, slightly above eye level")
- Hand gestures (e.g., "Right hand counting on fingers, palm facing camera")
- Body language (e.g., "Lean forward slightly with confident posture")
- Text overlays (e.g., "Text appears top-center: 'THE 3 SECRETS'")

The creator should be able to shoot the video EXACTLY as described without guessing.`);
  
  return `

--- OPTIONAL USER PREFERENCES (Apply subtly, video DNA is primary) ---
${hints.join('\n')}`;
}

// ============================================
// Main Generator (Master Prompt UNCHANGED)
// ============================================

/**
 * Generate a script using the "Steal Like an Artist" framework.
 * 
 * When visualAnalysis is provided, the script incorporates visual cues,
 * hook patterns, and scene flow from the reference video.
 */
export async function generateScript(options: ScriptGeneratorOptions): Promise<string>;
export async function generateScript(userIdea: string, transcript: string | null): Promise<string>;
export async function generateScript(
  optionsOrIdea: ScriptGeneratorOptions | string, 
  transcript?: string | null
): Promise<string> {
  // Handle both old and new signatures for backwards compatibility
  let options: ScriptGeneratorOptions;
  
  if (typeof optionsOrIdea === 'string') {
    // Legacy signature: generateScript(userIdea, transcript)
    options = {
      userIdea: optionsOrIdea,
      transcript: transcript ?? null,
      visualAnalysis: null
    };
  } else {
    options = optionsOrIdea;
  }

  const { userIdea, transcript: transcriptText, visualAnalysis } = options;

  // Build reference DNA section - now includes visual context if available
  let referenceDNA = '';
  
  if (transcriptText) {
    referenceDNA += `TRANSCRIPT (What was said):\n"${transcriptText}"\n\n`;
  }

  if (visualAnalysis) {
    if (visualAnalysis.visualCues.length > 0) {
      referenceDNA += `VISUAL HOOKS (What was shown):\n${visualAnalysis.visualCues.map(c => `- ${c}`).join('\n')}\n\n`;
    }
    if (visualAnalysis.hookType && visualAnalysis.hookType !== 'Unknown') {
      referenceDNA += `HOOK PATTERN: ${visualAnalysis.hookType}\n\n`;
    }
    if (visualAnalysis.tone && visualAnalysis.tone !== 'Unknown') {
      referenceDNA += `DETECTED TONE: ${visualAnalysis.tone}\n\n`;
    }
    if (visualAnalysis.sceneDescriptions.length > 0) {
      referenceDNA += `SCENE FLOW:\n${visualAnalysis.sceneDescriptions.join('\n')}\n\n`;
    }
  }

  if (!referenceDNA) {
    referenceDNA = 'No reference provided. Use an intense, strategic tone.';
  }

  // NEW: Include previous scripts as learning context
  let priorContext = '';
  if (options.previousScripts && options.previousScripts.length > 0) {
    priorContext = `

--- PRIOR GENERATION CONTEXT (Learn from these but create something NEW) ---
The following scripts were previously generated for THIS SAME video but with DIFFERENT ideas.
Use them to understand what worked well with this video's style, but DO NOT copy them.
Create a FRESH script for the NEW concept.

${options.previousScripts.slice(0, 2).map((ps, i) => `
PREVIOUS IDEA ${i + 1}: "${ps.idea}"
PREVIOUS SCRIPT ${i + 1}:
${ps.script}
`).join('\n')}
--- END PRIOR CONTEXT ---
`;
  }

  // ============================================
  // MASTER PROMPT CONSTRUCTION
  // ============================================
  const masterPrompt = createMasterPrompt(userIdea, referenceDNA);

  // Append optional hints (if any) WITHOUT modifying master prompt
  const optionalHints = buildOptionalHints(options);
  const fullPrompt = masterPrompt + priorContext + optionalHints;

  // Model configuration with fallback hierarchy (Vertex AI compatible)
  const MODEL_HIERARCHY = [
    'gemini-2.0-flash-001',  // Primary (New 2.0 Flash)
    'gemini-1.5-flash',      // Fallback
  ];

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  let lastError: any = null;

  const systemInstruction = `You are a World-Class Creative Strategist who follows the "Steal Like an Artist" philosophy. 
        
  Your goal is to perform a "Surgical Good Theft": 
  1. Analyze the DNA of a reference video (its pacing, psychological hooks, and logical structure).
  2. Emulate the *thinking* behind the reference, not the words.
  3. Remix that structure into a new script based on the user's specific concept.
  
  Rules:
  - No hashtags, no emojis, and no markdown.
  - Style: High-status, punchy, and calculated.
  - Tone: Pivot from a surface-level hook to a deep strategic truth.
  - Vocabulary: Use technical authority words (e.g., if UI/UX, use terms like 'visual hierarchy', '8pt grid', 'cognitive friction').`;

  for (const modelName of MODEL_HIERARCHY) {
    try {
      logger.info(`Generating script with model: ${modelName}${options.toneHint ? ` (tone hint: ${options.toneHint})` : ''}${options.mode === 'hook_only' ? ' (hook only)' : ''}`);
      
      const model = vertexAI.getGenerativeModel({ 
        model: modelName, 
        systemInstruction: systemInstruction,
      });

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      });
      const script = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return script.trim();

    } catch (error: any) {
      lastError = error;
      const isRateLimit = error.message?.includes('429') || error.status === 429;
      
      logger.warn(`Script generation failed on ${modelName}: ${error.message}`);

      if (isRateLimit) {
        logger.warn('Rate limit hit, waiting before retry...');
        await sleep(2000);
      }
    }
  }

  // If all models fail
  logger.error('All script generation models failed.');
  throw lastError || new Error('Script generation failed');
}


/**
 * ONE-SHOT GENERATOR: Generates script directly from video input (1 API Call)
 * Uses the EXACT SAME master prompt logic, but passes media directly to the model.
 */
export async function generateScriptFromVideo(options: OneShotGeneratorOptions): Promise<string> {
  const { userIdea, frames, audioPath } = options;
  
  // 1. Prepare Media Parts
  const mediaParts: Part[] = [];
  
  // Add Frames
  if (frames && frames.length > 0) {
    const framePromises = frames
      .filter(f => fs.existsSync(f))
      .map(f => fileToGenerativePart(f, 'image/jpeg'));
    mediaParts.push(...await Promise.all(framePromises));
  }
  
  // Add Audio
  if (audioPath && fs.existsSync(audioPath)) {
    mediaParts.push(await fileToGenerativePart(audioPath, 'audio/wav'));
  }

  // 2. Construct Prompt (Identical logic to text version)
  // Instead of text analysis, we point to the attached media as the reference
  const referenceDNA = `[VIDEO/AUDIO CONTENT ATTACHED]
  Analyze the attached video frames and audio directly. 
  Extract the pacing, tone, hook psychological structure, and language style from this media.
  THIS IS YOUR REFERENCE DNA.`;

  const masterPrompt = createMasterPrompt(userIdea, referenceDNA);
  
  // Hints & Context
  const optionalHints = buildOptionalHints(options);
  let priorContext = '';
  if (options.previousScripts && options.previousScripts.length > 0) {
    priorContext = `\n--- PRIOR GENERATION CONTEXT ---\n(See previous scripts for style learning)\n` + 
      options.previousScripts.map((ps, i) => `PREVIOUS ${i+1}: ${ps.script}`).join('\n');
  }

  const fullPrompt = masterPrompt + priorContext + optionalHints;

  // 3. Call Model (Gemini 2.0 Flash is best for multimodal one-shot)
  // We use 2.0 Flash because it handles video tokens natively and efficiently
  const modelName = 'gemini-2.0-flash-001';
  
  try {
    logger.info(`Generating One-Shot script with model: ${modelName}`);
    
    const model = vertexAI.getGenerativeModel({ 
      model: modelName,
      systemInstruction: "You are a World-Class Creative Strategist who follows the 'Steal Like an Artist' framework."
    });

    // Prepare content parts for Vertex AI
    const contentParts: Part[] = [
      { text: fullPrompt },
      ...mediaParts,
    ];

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: contentParts }],
    });
    const script = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return script.trim();

  } catch (error: any) {
    logger.error(`One-Shot generation failed: ${error.message}`);
    throw error;
  }
}

/**
 * SHARED MASTER PROMPT BUILDER
 * Ensures 100% consistency between text-based and video-based generation
 */
function createMasterPrompt(userIdea: string, referenceDNA: string): string {
  return `
  Apply the "Steal Like an Artist" framework to generate a new script.

  REFERENCE DNA (The Source to Steal From):
  ${referenceDNA}

  NEW CONCEPT (The Topic to Apply the DNA to):
  "${userIdea}"

  INSTRUCTIONS:
  1. **INTELLIGENT LINGUISTIC STYLE**: 
     - Detect the original language mix of the transcript.
     - **Check NEW CONCEPT for latent preferences**: If the user mentions a specific language or tone in "${userIdea}", prioritize that.
     - **GLOBAL ROMANIZATION RULE**: Regardless of the language used, you MUST use ONLY the English/Roman alphabet (ABC...). NEVER use native scripts like देवनागरी, ಕನ್ನಡ, etc. Romanize all non-English words naturally.
  
  2. **STRICT OUTPUT FORMAT**: Each section MUST exactly follow this marker format:
      
     [HOOK]
     🎬 VISUAL: (Specific camera direction/text overlay)
     💬 SAY: "(Exact words to speak - MUST BE ROMANIZED)"

     [BODY]
     🎬 VISUAL: (Scene description, on-screen text, transitions)
     💬 SAY: "(Spoken content)"
     
     (Multiple VISUAL/SAY pairs allowed per section)

     [CTA]
     🎬 VISUAL: (Final visual setup, text overlay if any)
     💬 SAY: "(Call to action dialogue)"
     
  3. VISUAL GUIDELINES:
     - Be specific: "Close-up face shot" not just "camera on face"
     - Include text overlays: "Text appears: 'The 80/20 Rule'"
     - Note transitions: "Jump cut to screen recording"
     
  4. DIALOGUE GUIDELINES:
     - Keep it punchy and spoken-natural
     - Match the reference's language style (Hinglish, casual English, etc.)
     - PACING: 30-45 seconds total spoken time

  Return ONLY the structured script with [HOOK], [BODY], [CTA] headers and 🎬 VISUAL: / 💬 SAY: lines. No other text.`;
}
