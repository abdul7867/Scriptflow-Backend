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
export type StoryFormat = 'story' | 'edgy' | 'tutorial';

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

  // Storytelling format for post-delivery restyling
  storyFormat?: StoryFormat;

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
// Language Detection (for Language Lock feature)
// ============================================

/**
 * Detect the primary language from a transcript
 * Returns language info to enforce output language matching
 * 
 * Priority: Detect from spoken words in transcript
 * If romanized (e.g., Hindi in English letters), output must also be romanized
 */
interface DetectedLanguage {
  language: string;          // e.g., 'Hindi', 'Kannada', 'Tamil', 'English', 'Arabic'
  isRomanized: boolean;      // true if using Latin alphabet for non-English
  confidence: 'high' | 'medium' | 'low';
  sampleWords: string[];     // Example words that triggered detection
}

function detectTranscriptLanguage(transcript: string | null): DetectedLanguage {
  if (!transcript || transcript.trim().length < 5) {
    return { language: 'English', isRomanized: false, confidence: 'low', sampleWords: [] };
  }

  const text = transcript.toLowerCase();
  const words = text.split(/\s+/);

  // Non-Latin script detection (Devanagari, Arabic, etc.)
  const hasDevanagari = /[\u0900-\u097F]/.test(transcript);
  const hasArabic = /[\u0600-\u06FF]/.test(transcript);
  const hasTamil = /[\u0B80-\u0BFF]/.test(transcript);
  const hasKannada = /[\u0C80-\u0CFF]/.test(transcript);
  const hasTelugu = /[\u0C00-\u0C7F]/.test(transcript);
  const hasBengali = /[\u0980-\u09FF]/.test(transcript);

  if (hasDevanagari) return { language: 'Hindi', isRomanized: false, confidence: 'high', sampleWords: [] };
  if (hasArabic) return { language: 'Arabic', isRomanized: false, confidence: 'high', sampleWords: [] };
  if (hasTamil) return { language: 'Tamil', isRomanized: false, confidence: 'high', sampleWords: [] };
  if (hasKannada) return { language: 'Kannada', isRomanized: false, confidence: 'high', sampleWords: [] };
  if (hasTelugu) return { language: 'Telugu', isRomanized: false, confidence: 'high', sampleWords: [] };
  if (hasBengali) return { language: 'Bengali', isRomanized: false, confidence: 'high', sampleWords: [] };

  // Romanized Hindi/Hinglish detection
  const hindiMarkers = ['hai', 'hain', 'kya', 'kaise', 'kyun', 'kuch', 'bahut', 'aap', 'tum', 'mujhe',
    'hamara', 'tumhara', 'yeh', 'woh', 'kar', 'karna', 'baat', 'nahi', 'nahin', 'hona', 'matlab',
    'zaroor', 'zaruri', 'samjho', 'samajh', 'dekho', 'sunao', 'suno', 'padho', 'likho', 'bolo',
    'apna', 'karo', 'karo', 'raha', 'rahi', 'rahe', 'wala', 'wali', 'wale', 'accha', 'theek',
    'aaj', 'kal', 'abhi', 'jab', 'tab', 'aur', 'lekin', 'par', 'phir', 'pehle', 'baad'];

  // Romanized Kannada detection
  const kannadaMarkers = ['idu', 'yenu', 'hege', 'yake', 'yavaga', 'nanage', 'ninage', 'avaru',
    'ivaru', 'aadre', 'antare', 'maadi', 'maadod', 'ella', 'ashte', 'haagu', 'mathu', 'illa',
    'beku', 'aagalla', 'nodri', 'kelri', 'heli', 'bandu', 'hogod', 'banni', 'barri'];

  // Romanized Tamil detection
  const tamilMarkers = ['enna', 'epdi', 'yaar', 'enga', 'enge', 'inga', 'appa', 'amma',
    'panni', 'pannunga', 'vaanga', 'ponga', 'sollu', 'kelvi', 'paaru', 'kudukka',
    'iruku', 'illa', 'vandhanga', 'poganum', 'varalaam', 'aana', 'aachu'];

  // Romanized Arabic/Urdu detection
  const arabicMarkers = ['inshallah', 'mashallah', 'alhamdulillah', 'wallah', 'yalla',
    'habibi', 'habibti', 'shukran', 'maafi', 'kheir', 'ahlan', 'marhaba'];

  // Count matches
  const countMatches = (markers: string[]) => {
    const found: string[] = [];
    for (const word of words) {
      if (markers.includes(word)) found.push(word);
    }
    return found;
  };

  const hindiMatches = countMatches(hindiMarkers);
  const kannadaMatches = countMatches(kannadaMarkers);
  const tamilMatches = countMatches(tamilMarkers);
  const arabicMatches = countMatches(arabicMarkers);

  // Return the language with most matches
  const results = [
    { lang: 'Hindi', matches: hindiMatches },
    { lang: 'Kannada', matches: kannadaMatches },
    { lang: 'Tamil', matches: tamilMatches },
    { lang: 'Arabic', matches: arabicMatches },
  ].sort((a, b) => b.matches.length - a.matches.length);

  const best = results[0];
  if (best.matches.length >= 3) {
    return {
      language: best.lang,
      isRomanized: true,
      confidence: 'high',
      sampleWords: best.matches.slice(0, 3)
    };
  } else if (best.matches.length >= 1) {
    return {
      language: best.lang,
      isRomanized: true,
      confidence: 'medium',
      sampleWords: best.matches
    };
  }

  // Default to English
  return { language: 'English', isRomanized: false, confidence: 'high', sampleWords: [] };
}

// ============================================
// Storytelling Format Prompts
// ============================================

const STORYTELLING_FORMATS: Record<StoryFormat, string> = {
  story: `
⚠️ STORYTELLING MODE: PERSONAL JOURNEY (Hero's Arc)
Use this EXACT structure instead of default format:

[HOOK] → THE BEFORE
🎬 VISUAL: Relatable expression, slight frustration or confusion
📝 TEXT OVERLAY: "I used to think..." or "Before I knew..."
💬 SAY: "I used to [old belief/struggle]..." - Start with relatable past state

[BODY] → THE TURNING POINT
🎬 VISUAL: Energy shift, lean forward, eyes widen
📝 TEXT OVERLAY: "Then I discovered..."
💬 SAY: "Then I [discovered/realized/learned]... This changed everything because [reason]"
💬 SAY: "The key insight was [specific revelation]..."

[CTA] → THE AFTER
🎬 VISUAL: Confident, transformed energy, slight smile
📝 TEXT OVERLAY: "Now I..." or result
💬 SAY: "Now I [new state/result]. You can do this too - [specific action]."
`,

  edgy: `
⚠️ STORYTELLING MODE: MYTH BUSTER / CONTRARIAN
Use this EXACT structure instead of default format:

[HOOK] → THE MYTH
🎬 VISUAL: Skeptical expression, maybe eye roll or head shake
📝 TEXT OVERLAY: "Everyone says..." or "Common advice:"
💬 SAY: "Everyone tells you [common belief]... They're completely wrong."

[BODY] → THE TRUTH
🎬 VISUAL: Serious, authoritative, direct eye contact
📝 TEXT OVERLAY: "The truth is..."
💬 SAY: "Here's what actually happens: [reality]. This is true because [evidence/logic]."
💬 SAY: "The reason this myth persists is [reason]. But smart people do [alternative]."

[CTA] → THE PROOF
🎬 VISUAL: Confident close, knowing smile
📝 TEXT OVERLAY: Result or action
💬 SAY: "I tried this and [specific result]. Stop following bad advice - do this instead."
`,

  tutorial: `
⚠️ STORYTELLING MODE: STEP-BY-STEP TUTORIAL
Use this EXACT structure instead of default format:

[HOOK] → THE PROMISE
🎬 VISUAL: Excited, helpful energy, maybe holding fingers up for "3 steps"
📝 TEXT OVERLAY: "How to [outcome] in 60 seconds"
💬 SAY: "Here's exactly how to [outcome] - takes 60 seconds."

[BODY] → THE STEPS
🎬 VISUAL: Count on fingers, clear gestures for each step
📝 TEXT OVERLAY: "Step 1: [action]"
💬 SAY: "Step 1: [specific action]. This matters because [quick reason]."

📝 TEXT OVERLAY: "Step 2: [action]"
💬 SAY: "Step 2: [specific action]. Key tip: [insight]."

📝 TEXT OVERLAY: "Step 3: [action]"
💬 SAY: "Step 3: [specific action]. And that's it."

[CTA] → THE RESULT
🎬 VISUAL: Thumbs up or confident nod
📝 TEXT OVERLAY: "Now go do it!"
💬 SAY: "Now you can [outcome]. Save this and try it today."
`,
};

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

  // STORYTELLING FORMAT (HIGHEST PRIORITY - changes entire structure)
  if (options.storyFormat && STORYTELLING_FORMATS[options.storyFormat]) {
    hints.push(STORYTELLING_FORMATS[options.storyFormat]);
  }

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

  // Detect language from transcript for Language Lock
  const detectedLang = detectTranscriptLanguage(options.transcript);
  const languageOverride = options.languageHint; // User can override if they want different language

  // ============================================
  // MASTER PROMPT CONSTRUCTION
  // ============================================
  const masterPrompt = createMasterPrompt(userIdea, referenceDNA, detectedLang, languageOverride);

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

  // For One-Shot, we detect language from audio if provided
  // Since we don't have transcript yet in One-Shot, we pass null and let AI detect from audio
  const detectedLang = detectTranscriptLanguage(options.transcript);
  const languageOverride = options.languageHint;

  const masterPrompt = createMasterPrompt(userIdea, referenceDNA, detectedLang, languageOverride);

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
 * ENHANCED V4:
 * - LANGUAGE LOCK at TOP (highest priority - preserves spoken language)
 * - TEXT OVERLAY separated from VISUAL for easy shooting
 * - "BECAUSE" explanations for every insight
 * - Psychological hook engineering with 10 hook archetypes
 * - Niche-specific tone calibration
 * - Anti-generic language filter
 */
function createMasterPrompt(
  userIdea: string,
  referenceDNA: string,
  detectedLang: DetectedLanguage,
  languageOverride?: string
): string {
  // Build LANGUAGE LOCK section - appears FIRST in prompt for highest priority
  const effectiveLanguage = languageOverride || detectedLang.language;
  const isRomanized = !languageOverride && detectedLang.isRomanized;

  const languageLockSection = `
🔒🔒🔒 LANGUAGE LOCK (HIGHEST PRIORITY - READ FIRST!) 🔒🔒🔒
═══════════════════════════════════════════════════════════════════════
DETECTED LANGUAGE: ${detectedLang.language}${detectedLang.isRomanized ? ' (Romanized/Transliterated)' : ''}
${detectedLang.sampleWords.length > 0 ? `DETECTED FROM: "${detectedLang.sampleWords.join('", "')}"` : ''}
${languageOverride ? `USER OVERRIDE: ${languageOverride}` : ''}

⚠️ OUTPUT LANGUAGE: ${effectiveLanguage}${isRomanized ? ' (ROMANIZED using Latin alphabet A-Z)' : ''}

STRICT RULES:
• ALL spoken dialogue (💬 SAY:) MUST be in ${effectiveLanguage}${isRomanized ? ' using ONLY Latin letters (A-Z)' : ''}
• If source is romanized Hindi/Kannada/Tamil/etc → output MUST also be romanized
• DO NOT translate to English unless user explicitly requested English
• DO NOT switch languages mid-script
• Technical labels (🎬 VISUAL, 📝 TEXT OVERLAY) are always in English
• When in doubt, match the SOURCE language exactly

EXAMPLE:
${effectiveLanguage === 'Hindi' && isRomanized ?
      '✅ CORRECT: "Aap yeh galti mat karo - yeh bahut important hai"\n❌ WRONG: "Don\'t make this mistake - it\'s very important"' :
      effectiveLanguage === 'Kannada' && isRomanized ?
        '✅ CORRECT: "Idu tumba important - nodri please"\n❌ WRONG: "This is very important - please watch"' :
        '✅ CORRECT: Preserve the exact language style from the reference'}
═══════════════════════════════════════════════════════════════════════

`;
  return `${languageLockSection}
═══════════════════════════════════════════════════════════════════════
"STEAL LIKE AN ARTIST" - SURGICAL SCRIPT TRANSFORMATION V3
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
5. NICHE VOCABULARY: What specific terminology resonates with this audience?

═══════════════════════════════════════════════════════════════════════
STEP 2: TRANSFORM FOR NEW CONCEPT
═══════════════════════════════════════════════════════════════════════
NEW CONCEPT: "${userIdea}"

Apply the reference's THINKING (not words) to this new topic.
The output should feel like it could be from the same creator, but on a different subject.

═══════════════════════════════════════════════════════════════════════
HOOK ENGINEERING - CHOOSE THE RIGHT ARCHETYPE:
═══════════════════════════════════════════════════════════════════════
Select the BEST hook type for this concept:

1. 🚫 CONTRARIAN: "Everyone says X... but here's the truth"
2. ❓ CURIOSITY GAP: "I discovered something that changed everything"
3. 🔢 LISTICLE TEASE: "3 things nobody tells you about..."
4. 😱 SHOCK OPENER: Start with the most surprising fact FIRST
5. 🪞 IDENTITY CALL: "If you're a [type of person], you need to hear this"
6. 🎭 STORY HOOK: "I was doing [X] when [unexpected thing happened]..."
7. ⚠️ URGENT WARNING: "Stop doing [common thing] immediately"
8. 🤔 MYTH BUSTER: "[Common belief] is actually destroying your [goal]"
9. 💡 AHA MOMENT: "The moment I realized [insight], everything changed"
10. 🎯 DIRECT CHALLENGE: "You're probably making this mistake right now"

Pick ONE that fits the concept. Do NOT use generic hooks.

═══════════════════════════════════════════════════════════════════════
LANGUAGE RULES (CRITICAL - READ CAREFULLY):
═══════════════════════════════════════════════════════════════════════
PRIORITY ORDER for language detection:
1. AUDIO (spoken words in transcript) > CAPTIONS (on-screen text) > VISUAL TEXT
2. The SPOKEN language in the transcript is what matters, NOT the caption language

STRICT RULES:
• Detect the SPOKEN language from the transcript (ignore on-screen text language)
• If the video SPEAKS in English but has captions in Hindi/Arabic/etc → OUTPUT IN ENGLISH
• If the video SPEAKS in Hindi/Arabic/etc → Romanize to English alphabet (transliterate)
• ALL output MUST use Roman alphabet (A-Z) - no Hindi, Arabic, Chinese, or other scripts
• Visual directions (🎬 VISUAL) and Technical labels must ALWAYS be in English
• NO random language switching mid-script
• When in doubt, default to ENGLISH

EXAMPLES:
✅ CORRECT: Video speaks English with Hindi captions → Script in English
✅ CORRECT: Video speaks Hindi → Script in romanized Hindi (e.g., "Aap yeh galti mat karo")
❌ WRONG: Video speaks English → Script outputs in Hindi/Arabic script
❌ WRONG: Mixing देवनागरी or عربي characters in output

═══════════════════════════════════════════════════════════════════════
QUALITY REQUIREMENTS V4 (NATURAL + VIRAL):
═══════════════════════════════════════════════════════════════════════
• Every claim needs "BECAUSE" - explain WHY, not just WHAT
• Hooks must trigger ONE specific emotion from the archetype list above
• 25-40 seconds total spoken time (punchy, no filler)
• Each insight must provide ACTIONABLE value, not just information
• Use SPECIFIC numbers/examples (not "many people" but "73% of creators")

🎯 DIALOGUE NATURALNESS (CRITICAL FOR ENGAGEMENT):
Dialogue must sound like you're talking to a FRIEND, not reading a script.

✅ NATURAL (Use these patterns):
• "Look, here's the thing..." (conversational opener)
• "I'm gonna be honest with you..." (creates trust)
• "You know what? Most people get this wrong." (relatable challenge)
• "Here's what changed everything for me..." (story hook)
• "And honestly? That's the part nobody talks about." (insider knowledge)
• Use contractions: "I'm", "you're", "don't", "here's", "that's"
• Short sentences. Punchy. Like this.
• Questions that make them think: "Sound familiar?", "Right?"

❌ ROBOTIC (Never use these patterns):
• "It is important to note that..." (formal, boring)
• "One should consider..." (third person, detached)
• "This is a significant factor..." (essay language)
• "In order to achieve success..." (overly formal)
• Long compound sentences with multiple clauses
• Perfect grammar that sounds unnatural when spoken

🔥 VIRAL HOOK TECHNIQUES (Use first 3 words to STOP scrolling):
• "I lost $10,000..." (loss triggers stronger than gain)
• "Stop doing this..." (pattern interrupt + urgency)
• "Nobody talks about..." (exclusive insider info)
• "The real reason..." (conspiracy/truth reveal)
• "I tested 100..." (curiosity + specific number)
• "Delete this now..." (urgency + taboo)
• "Warning: This will..." (threat/promise combo)
• "They don't want you to know..." (us vs them)

═══════════════════════════════════════════════════════════════════════
BANNED PHRASES (NEVER USE - These kill engagement):
═══════════════════════════════════════════════════════════════════════
❌ "In this video..." (boring YouTuber energy)
❌ "Let me tell you..." (sounds like a lecture)
❌ "So basically..." (filler, wastes time)
❌ "What I'm going to show you..." (kills curiosity)
❌ "You might be wondering..." (assumes their thoughts)
❌ "Trust me when I say..." (desperation signal)
❌ "It's important to understand..." (essay language)
❌ "The thing is..." (vague, unhelpful)
❌ Starting with "So..." or "Okay so..." (weak openers)
❌ Ending with "...and that's it" or "...hope this helps" (flat closings)
❌ "First of all..." (boring list energy)
❌ "As you can see..." (obvious, filler)
❌ "I just wanted to share..." (weak, apologetic)
❌ "Quick tip:" (overused, generic)
❌ "Game changer" (buzzword, meaningless)
❌ "Did you know that..." (trivia energy, not viral)


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
VISUAL DIRECTION STANDARDS (BE HYPER-SPECIFIC):
═══════════════════════════════════════════════════════════════════════
For 🎬 VISUAL, specify ALL of these:
✓ Shot type: "Close-up face shot" / "Medium shot waist-up" / "Wide shot with background"
✓ Camera angle: "Phone at eye level" / "Slightly above looking down" / "Low angle looking up"
✓ Distance: "2 feet from face" / "Arms length away"
✓ Expression: "Eyebrows raised, slight smirk" / "Serious, direct eye contact"
✓ Hands/Body: "Right hand counting on fingers" / "Arms crossed, leaning back"
✓ Movement: "Quick zoom in on 'secret'" / "Pan left to reveal whiteboard"
✓ Lighting mood: "Bright ring light" / "Moody side lighting" / "Natural window light"

For 📝 TEXT OVERLAY:
✓ Keep it 3-5 words MAX (shorter = more impact)
✓ Use power words: "The REAL Reason...", "Nobody Tells You...", "3 Secrets..."
✓ Position: "Top-center" / "Bottom-third" if relevant
✓ Style hint: "Bold caps" / "Handwritten style" if impactful

═══════════════════════════════════════════════════════════════════════
NICHE-SPECIFIC TONE CALIBRATION:
═══════════════════════════════════════════════════════════════════════
Adapt your vocabulary and energy:
• Business/Finance: Data-driven, authority language, ROI focus
• Fitness/Health: Energetic, motivational, transformation stories
• Tech/Coding: Precise, problem-solution, efficiency focus
• Lifestyle/Fashion: Aspirational, aesthetic, relatable moments
• Education: Clear explanations, examples, step-by-step
• Comedy/Entertainment: Timing, callbacks, unexpected twists
• Relationships: Emotional intelligence, vulnerability, connection

Match the niche energy in your word choices, examples, and delivery style.

═══════════════════════════════════════════════════════════════════════
QUALITY CHECKLIST (Verify before output):
═══════════════════════════════════════════════════════════════════════
✓ Hook uses ONE specific archetype from the list above
✓ Hook triggers emotion in first 3 words
✓ Each insight has "because" explanation (the WHY)
✓ Every 💬 SAY has matching 📝 TEXT OVERLAY  
✓ Visuals specific enough for a stranger to film exactly
✓ Dialogue sounds like natural speech (contractions, rhythm)
✓ Language matches reference transcript exactly
✓ NO banned phrases anywhere in the script
✓ Total spoken time: 25-40 seconds (read it aloud mentally)
✓ Each section provides standalone value

Return ONLY the formatted script with [HOOK], [BODY], [CTA] sections.
No additional commentary or explanation outside the script.`;
}
