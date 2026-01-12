import { VertexAI, Part } from '@google-cloud/vertexai';
import fs from 'fs';
import { logger } from '../../utils/logger';
import { VideoAnalysis } from '../video/videoAnalyzer.service';
import { config } from '../../config';

// Initialize Vertex AI
const vertexAI = new VertexAI({
  project: config.GCP_PROJECT_ID,
  location: config.GCP_LOCATION,
  googleAuthOptions: {
    keyFilename: config.GOOGLE_APPLICATION_CREDENTIALS || undefined,
  },
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

/** Summary of a previous variation to help AI avoid repetition */
export interface VariationSummary {
  idea: string;
  hookSummary: string;
  angleSummary: string;
  isSameIdea: boolean;
}

export interface ScriptGeneratorOptions {
  userIdea: string;
  transcript: string | null;
  visualAnalysis?: VideoAnalysis | null;

  // NEW: Optional hints (work WITH video DNA, not override)
  toneHint?: ToneHint;
  languageHint?: string;
  mode?: GenerationMode;

  // Previous scripts with DIFFERENT ideas (for context/learning)
  previousScripts?: { idea: string; script: string }[];

  // Previous variation SUMMARIES with SAME idea (for avoiding repetition)
  previousVariationSummaries?: VariationSummary[];
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

  // CRITICAL: Add variation avoidance instructions if user is regenerating
  if (options.previousVariationSummaries && options.previousVariationSummaries.length > 0) {
    const summaries = options.previousVariationSummaries;
    hints.push(`
🔄 VARIATION MODE - CREATE SOMETHING DISTINCTLY DIFFERENT!
The user has already generated ${summaries.length} script(s) for this SAME idea.
You MUST create a FRESH, UNIQUE version that is NOTICEABLY DIFFERENT.

HOOKS TO AVOID (do NOT use similar openings):
${summaries.map((s, i) => `${i + 1}. "${s.hookSummary}"`).join('\n')}

ANGLES TO AVOID (do NOT use similar approaches):
${summaries.map((s, i) => `${i + 1}. "${s.angleSummary}"`).join('\n')}

VARIATION REQUIREMENTS:
- Use a COMPLETELY DIFFERENT hook style (question vs statement, shocking fact vs relatable moment, etc.)
- Take a DIFFERENT angle/perspective on the topic
- Use DIFFERENT examples or analogies
- Change the emotional tone (curiosity vs urgency vs humor)
- If previous was direct, try storytelling. If previous was personal, try educational.

The user wants VARIETY - give them something they haven't seen before!`);
  }

  // Always add visual guidance reminder for better shooting instructions
  if (hints.length > 0) {
    hints.push(`
VISUAL DIRECTION REMINDER:
For each 🎬 VISUAL: line, be EXTREMELY SPECIFIC about:
- Exact camera angle (e.g., "Close-up face shot, slightly above eye level")
- Hand gestures (e.g., "Right hand counting on fingers, palm facing camera")
- Body language (e.g., "Lean forward slightly with confident posture")
- Text overlays (e.g., "Text appears top-center: 'THE 3 SECRETS'")

The creator should be able to shoot the video EXACTLY as described without guessing.`);
  }

  if (hints.length === 0) return '';

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
    'gemini-2.5-flash',          // Primary (2.5 Flash)
    'gemini-2.0-flash-001',      // Fallback (2.0 Flash)
  ];

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  let lastError: any = null;

  const systemInstruction = `You are a Master Script Alchemist practicing "Steal Like an Artist."

Your philosophy:
"Good artists copy. Great artists STEAL." - Picasso
"Steal the THINKING, not the words." - Austin Kleon

You decode viral content DNA and transplant it into new ideas. Your scripts:
• Open with psychological hooks (curiosity gaps, pattern interrupts, identity triggers)
• Explain the WHY behind every claim (not just what, but BECAUSE...)
• Include both 🎬 VISUAL and 📝 TEXT OVERLAY for each beat
• Match the reference's language and energy exactly

RULES (NON-NEGOTIABLE):
- No hashtags, no markdown formatting
- Technical vocabulary for technical niches, emotional for lifestyle
- Every insight backed by "because" explanation
- Each 💬 SAY has a corresponding 📝 TEXT OVERLAY
- Language MUST match reference transcript (romanize non-English)`;

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
      options.previousScripts.map((ps, i) => `PREVIOUS ${i + 1}: ${ps.script}`).join('\n');
  }

  const fullPrompt = masterPrompt + priorContext + optionalHints;

  // 3. Call Model (Gemini 2.5 Flash is best for multimodal one-shot)
  // We use 2.5 Flash because it handles video tokens natively and efficiently
  const modelName = 'gemini-2.5-flash';

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
 * "Steal Like an Artist" framework with enhanced quality directives
 * 
 * ENHANCED V2:
 * - TEXT OVERLAY separated from VISUAL for easy shooting
 * - "BECAUSE" explanations for every insight
 * - Psychological hook engineering
 */
function createMasterPrompt(userIdea: string, referenceDNA: string): string {
  return `
═══════════════════════════════════════════════════════════════════════
"STEAL LIKE AN ARTIST" - SURGICAL SCRIPT TRANSFORMATION
═══════════════════════════════════════════════════════════════════════

You are performing a SURGICAL GOOD THEFT:
• BAD THIEF: Steals the words → obvious copy
• GOOD THIEF: Steals the THINKING → original work that FEELS familiar

═══════════════════════════════════════════════════════════════════════
STEP 1: DECODE THE REFERENCE DNA
═══════════════════════════════════════════════════════════════════════
${referenceDNA}

Extract these elements:
1. HOOK PSYCHOLOGY: What emotion triggers the opening? (curiosity, fear, shock, relatability)
2. STRUCTURE PATTERN: How does tension build? (problem→solution, myth→truth, story→lesson)
3. PACING DNA: Fast punchy cuts or slow emotional builds?
4. AUTHORITY MARKERS: What makes the speaker credible?

═══════════════════════════════════════════════════════════════════════
STEP 2: TRANSFORM FOR NEW CONCEPT
═══════════════════════════════════════════════════════════════════════
NEW CONCEPT: "${userIdea}"

Apply the reference's THINKING (not words) to this new topic.
The output should feel like it could be from the same creator, but on a different subject.

═══════════════════════════════════════════════════════════════════════
LANGUAGE RULES (NON-NEGOTIABLE):
═══════════════════════════════════════════════════════════════════════
• DETECT the transcript language → Output in SAME language
• Use ONLY Roman alphabet (romanize Hindi, Arabic, etc.)
• NO random language switching mid-script
• If no transcript, default to English

═══════════════════════════════════════════════════════════════════════
QUALITY REQUIREMENTS:
═══════════════════════════════════════════════════════════════════════
• Every claim needs "BECAUSE" - explain WHY, not just WHAT
• Hooks must trigger: curiosity gap, pattern interrupt, or identity call
• 30-45 seconds total spoken time (punchy, no filler)

═══════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (EXACT - FOLLOW PRECISELY):
═══════════════════════════════════════════════════════════════════════

[HOOK]
🎬 VISUAL: (Camera position, facial expression, gestures, background)
📝 TEXT OVERLAY: "(Exact on-screen text - 3-5 words max, bold impact)"
💬 SAY: "(Opening line - pattern interrupt, max 2 sentences)"

[BODY]
🎬 VISUAL: (Camera setup for insight 1)
📝 TEXT OVERLAY: "(Key point #1 summary)"
💬 SAY: "(Insight #1 + BECAUSE explanation - explain WHY this matters)"

🎬 VISUAL: (Camera setup for insight 2)
📝 TEXT OVERLAY: "(Key point #2 summary)"
💬 SAY: "(Insight #2 + BECAUSE explanation - deeper value, connect to audience)"

🎬 VISUAL: (Camera setup for insight 3 - optional if content needs depth)
📝 TEXT OVERLAY: "(Key point #3 summary)"
💬 SAY: "(Insight #3 + BECAUSE explanation - tie everything together)"

[CTA]
🎬 VISUAL: (Confident close-up, engaging expression, hand gesture if needed)
📝 TEXT OVERLAY: "(Action words: Follow, Save, Share, Try This)"
💬 SAY: "(Clear call to action - what should viewer do NOW?)"

═══════════════════════════════════════════════════════════════════════
VISUAL DIRECTION STANDARDS:
═══════════════════════════════════════════════════════════════════════
For 🎬 VISUAL, be HYPER-SPECIFIC:
✓ Camera: "Close-up face shot, phone at eye level, 2 feet away"
✓ Expression: "Confused look transforming to confident smile"
✓ Gestures: "Right hand counting on fingers starting at 1"
✓ Movement: "Lean in slightly when revealing the secret"

For 📝 TEXT OVERLAY:
✓ Keep it 3-5 words MAX
✓ Use power words: "The REAL Reason...", "Nobody Tells You...", "3 Secrets..."
✓ Position: Specify top/center/bottom if important

═══════════════════════════════════════════════════════════════════════
QUALITY CHECKLIST (Verify before output):
═══════════════════════════════════════════════════════════════════════
✓ Hook triggers emotion, not just states information
✓ Each insight has "because" explanation (the WHY)
✓ Every 💬 SAY has matching 📝 TEXT OVERLAY
✓ Visuals specific enough for a stranger to film
✓ Language matches reference transcript exactly
✓ No generic filler ("In this video...", "Let me tell you...")

Return ONLY the formatted script with [HOOK], [BODY], [CTA] sections.
No additional commentary or explanation outside the script.`;
}
