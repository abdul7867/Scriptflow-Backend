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

/**
 * Truncate transcript to prevent token explosion
 */
function truncateTranscript(text: string | null, maxWords: number = 750): string {
    if (!text) return '';
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(' ') + '... [TRUNCATED for token safety]';
}

// ============================================
// Types
// ============================================

export type ToneHint = 'professional' | 'funny' | 'provocative' | 'educational' | 'casual';
export type GenerationMode = 'full' | 'hook_only';
export type StoryFormat = 'story' | 'edgy' | 'tutorial';

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

    toneHint?: ToneHint;
    languageHint?: string;
    mode?: GenerationMode;
    storyFormat?: StoryFormat;

    // NEW: Remix mode - preserve original topic, improve delivery
    isRemix?: boolean;

    previousScripts?: { idea: string; script: string }[];
    previousVariationSummaries?: VariationSummary[];
}

export interface OneShotGeneratorOptions extends ScriptGeneratorOptions {
    frames: string[];
    audioPath?: string | null;
}

// ============================================
// Language Detection
// ============================================

interface DetectedLanguage {
    language: string;
    isRomanized: boolean;
    confidence: 'high' | 'medium' | 'low';
    sampleWords: string[];
}

function detectTranscriptLanguage(transcript: string | null): DetectedLanguage {
    if (!transcript || transcript.trim().length < 5) {
        return { language: 'English', isRomanized: false, confidence: 'low', sampleWords: [] };
    }

    const text = transcript.toLowerCase();
    const words = text.split(/\s+/);

    // Non-Latin script detection
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

    // Romanized language detection
    const hindiMarkers = ['hai', 'hain', 'kya', 'kaise', 'kyun', 'kuch', 'bahut', 'aap', 'tum', 'mujhe',
        'hamara', 'tumhara', 'yeh', 'woh', 'kar', 'karna', 'baat', 'nahi', 'nahin', 'hona', 'matlab',
        'zaroor', 'zaruri', 'samjho', 'samajh', 'dekho', 'sunao', 'suno', 'padho', 'likho', 'bolo',
        'apna', 'karo', 'raha', 'rahi', 'rahe', 'wala', 'wali', 'wale', 'accha', 'theek',
        'aaj', 'kal', 'abhi', 'jab', 'tab', 'aur', 'lekin', 'par', 'phir', 'pehle', 'baad'];

    const kannadaMarkers = ['idu', 'yenu', 'hege', 'yake', 'yavaga', 'nanage', 'ninage', 'avaru',
        'ivaru', 'aadre', 'antare', 'maadi', 'maadod', 'ella', 'ashte', 'haagu', 'mathu', 'illa',
        'beku', 'aagalla', 'nodri', 'kelri', 'heli', 'bandu', 'hogod', 'banni', 'barri'];

    const tamilMarkers = ['enna', 'epdi', 'yaar', 'enga', 'enge', 'inga', 'appa', 'amma',
        'panni', 'pannunga', 'vaanga', 'ponga', 'sollu', 'kelvi', 'paaru', 'kudukka',
        'iruku', 'illa', 'vandhanga', 'poganum', 'varalaam', 'aana', 'aachu'];

    const arabicMarkers = ['inshallah', 'mashallah', 'alhamdulillah', 'wallah', 'yalla',
        'habibi', 'habibti', 'shukran', 'maafi', 'kheir', 'ahlan', 'marhaba'];

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

    return { language: 'English', isRomanized: false, confidence: 'high', sampleWords: [] };
}

// ============================================
// Storytelling Format Prompts
// ============================================

const STORYTELLING_FORMATS: Record<StoryFormat, string> = {
    story: `
⚠️ STORYTELLING MODE: PERSONAL TRANSFORMATION

[HOOK] → THE STRUGGLE
🎬 VISUAL: Vulnerable expression, slight frustration, looking down then up
📝 TEXT OVERLAY: "I USED TO..."
💬 SAY: "[Relatable struggle 3-5 words]. [Painful before state]. [What failed]."

[BODY - PART 1] → THE DISCOVERY
🎬 VISUAL: Energy shifts - eyes widen, lean forward, hand on chest
📝 TEXT OVERLAY: "THEN I FOUND..."
💬 SAY: "[Discovery moment]. [What changed everything]. [Key insight]."

[BODY - PART 2] → THE PROOF
🎬 VISUAL: Confident, showing results
📝 TEXT OVERLAY: "[SPECIFIC RESULT]"
💬 SAY: "[Concrete outcome with numbers]. [Why it worked]. [Mistake to avoid]."

[CTA] → THE INVITATION
🎬 VISUAL: Direct eye contact, encouraging smile, open gesture
📝 TEXT OVERLAY: "YOUR TURN"
💬 SAY: "[You can do this]. [First step]. [Follow for method]."

TONE: Vulnerable → Hopeful → Empowered
LENGTH: 45-75 seconds
`,

    edgy: `
⚠️ STORYTELLING MODE: CONTRARIAN AUTHORITY

[HOOK] → THE LIE
🎬 VISUAL: Skeptical - eye roll, head shake, dismissive wave
📝 TEXT OVERLAY: "EVERYONE SAYS..."
💬 SAY: "[Common belief 3-5 words]. [Bad advice directly]. [Pause]."

[BODY - PART 1] → THE TRUTH BOMB
🎬 VISUAL: Serious, leaning in, pointing at camera
📝 TEXT OVERLAY: "THE TRUTH?"
💬 SAY: "[Contrarian statement]. [What actually happens]. [Why myth persists]."

[BODY - PART 2] → THE EVIDENCE
🎬 VISUAL: Show data or results
📝 TEXT OVERLAY: "[STAT or RESULT]"
💬 SAY: "[Specific data]. [What smart people do instead]. [What everyone misses]."

[CTA] → THE CHALLENGE
🎬 VISUAL: Confident smirk, arms crossed
📝 TEXT OVERLAY: "TRY IT"
💬 SAY: "[My result]. [Stop bad advice]. [Follow for real strategy]."

TONE: Skeptical → Authoritative → Challenging
LENGTH: 30-50 seconds
`,

    tutorial: `
⚠️ STORYTELLING MODE: ACTIONABLE WALKTHROUGH

[HOOK] → THE PROMISE
🎬 VISUAL: Excited, holding up fingers for steps
📝 TEXT OVERLAY: "HOW TO [OUTCOME]"
💬 SAY: "[Outcome 3-5 words]. [Time promise]. [Credibility]."

[BODY] → THE STEPS

🎬 VISUAL: Show step, count on fingers
📝 TEXT OVERLAY: "STEP 1: [ACTION]"
💬 SAY: "Step 1: [Action]. [Detail]. [Mistake to avoid]."

🎬 VISUAL: Next step demo
📝 TEXT OVERLAY: "STEP 2: [ACTION]"
💬 SAY: "Step 2: [Action]. [Why this order]. [Pro tip]."

🎬 VISUAL: Final step, zoom for emphasis
📝 TEXT OVERLAY: "STEP 3: [ACTION]"
💬 SAY: "Step 3: [Action]. [Result]. [No fluff]."

[CTA] → THE ACTIVATION
🎬 VISUAL: Thumbs up, confident nod
📝 TEXT OVERLAY: "NOW GO"
💬 SAY: "[Now you can X]. [Save this]. [Follow for more]."

TONE: Helpful → Clear → Encouraging
LENGTH: 35-60 seconds
`,
};

// ============================================
// Hint Builder
// ============================================

function buildOptionalHints(options: ScriptGeneratorOptions): string {
    const hints: string[] = [];

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
TONE PREFERENCE (subtle, video DNA is primary):
User prefers "${options.toneHint}" (${toneDescriptions[options.toneHint]}). 
Lean slightly this direction while keeping reference style dominant.`);
    }

    if (options.languageHint) {
        hints.push(`
LANGUAGE OVERRIDE:
Write ALL dialogue (💬 SAY:) in ${options.languageHint}.
Use Roman alphabet (A-Z) for romanization.`);
    }

    if (options.mode === 'hook_only') {
        hints.push(`
MODE: HOOK ONLY
Generate ONLY [HOOK]. Skip [BODY] and [CTA].
Make it extra impactful since standalone.`);
    }

    if (options.previousVariationSummaries && options.previousVariationSummaries.length > 0) {
        const summaries = options.previousVariationSummaries.slice(-2);
        hints.push(`
🔄 VARIATION MODE - MAKE IT DIFFERENT!
User generated ${options.previousVariationSummaries.length} scripts. Create UNIQUE version.

HOOKS TO AVOID:
${summaries.map((s, i) => `${i + 1}. "${s.hookSummary}"`).join('\n')}

ANGLES TO AVOID:
${summaries.map((s, i) => `${i + 1}. "${s.angleSummary}"`).join('\n')}

REQUIREMENTS:
- Different hook archetype
- Different angle/perspective
- Different examples
- Different emotional tone`);
    }

    if (hints.length === 0) return '';

    return `\n\n--- USER PREFERENCES ---${hints.join('\n')}`;
}

// ============================================
// Main Generator
// ============================================

export async function generateScript(options: ScriptGeneratorOptions): Promise<string>;
export async function generateScript(userIdea: string, transcript: string | null): Promise<string>;
export async function generateScript(
    optionsOrIdea: ScriptGeneratorOptions | string,
    transcript?: string | null
): Promise<string> {
    let options: ScriptGeneratorOptions;

    if (typeof optionsOrIdea === 'string') {
        options = {
            userIdea: optionsOrIdea,
            transcript: transcript ?? null,
            visualAnalysis: null
        };
    } else {
        options = optionsOrIdea;
    }

    const { userIdea, transcript: transcriptText, visualAnalysis } = options;

    // Build reference DNA
    let referenceDNA = '';
    const safeTranscript = truncateTranscript(transcriptText);

    if (safeTranscript) {
        referenceDNA += `TRANSCRIPT:\n"${safeTranscript}"\n\n`;
    }

    if (visualAnalysis) {
        if (visualAnalysis.visualCues.length > 0) {
            referenceDNA += `VISUAL CUES:\n${visualAnalysis.visualCues.map(c => `- ${c}`).join('\n')}\n\n`;
        }
        if (visualAnalysis.hookType && visualAnalysis.hookType !== 'Unknown') {
            referenceDNA += `HOOK PATTERN: ${visualAnalysis.hookType}\n\n`;
        }
        if (visualAnalysis.tone && visualAnalysis.tone !== 'Unknown') {
            referenceDNA += `TONE: ${visualAnalysis.tone}\n\n`;
        }
        if (visualAnalysis.sceneDescriptions.length > 0) {
            referenceDNA += `SCENES:\n${visualAnalysis.sceneDescriptions.join('\n')}\n\n`;
        }
    }

    if (!referenceDNA) {
        referenceDNA = 'No reference. Use strategic, engaging tone.';
    }

    // Prior context
    let priorContext = '';
    if (options.previousScripts && options.previousScripts.length > 0) {
        const relevantScripts = options.previousScripts.slice(-2);
        priorContext = `\n--- LEARN FROM THESE (different ideas, same style) ---\n${relevantScripts.map((ps, i) => `
IDEA ${i + 1}: "${ps.idea}"
SCRIPT: ${ps.script}`).join('\n')}\n--- END CONTEXT ---\n`;
    }

    const detectedLang = detectTranscriptLanguage(safeTranscript);
    const languageOverride = options.languageHint;

    // Pass isRemix flag so prompt preserves original topic instead of changing it
    const masterPrompt = createMasterPrompt(userIdea, referenceDNA, detectedLang, languageOverride, options.isRemix);
    const optionalHints = buildOptionalHints(options);
    const fullPrompt = masterPrompt + priorContext + optionalHints;

    const MODEL_HIERARCHY = [
        'gemini-2.5-flash',          // Primary
        'gemini-2.0-flash-001',      // Fallback
    ];

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    let lastError: any = null;

    const systemInstruction = `You are a Viral Script Writer studying human conversation patterns.

Your Goal:
Write scripts that sound like a friend talking, NOT like an essay.

Your Scripts Must:
• Hook in 3 words (not 3 seconds)
• Sound natural when spoken
• Include camera directions and text overlays
• Work in ANY language (use A-Z letters for romanization)

NEVER:
- Use hashtags
- Use markdown in dialogue
- Use emojis in spoken words
- Switch languages mid-script`;

    for (const modelName of MODEL_HIERARCHY) {
        try {
            logger.info(`Generating script with ${modelName}${options.toneHint ? ` (${options.toneHint})` : ''}${options.mode === 'hook_only' ? ' [hook only]' : ''}`);

            const model = vertexAI.getGenerativeModel({
                model: modelName,
                systemInstruction: systemInstruction,
                generationConfig: {
                    maxOutputTokens: 1500,  // FIXED: Allows full scripts
                    temperature: 0.9,
                    topP: 0.95,
                }
            });

            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
            });

            const script = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '';

            // Validation
            const validationIssues = validateScript(script);
            if (validationIssues.length > 0) {
                logger.warn(`Validation warnings on ${modelName}: ${validationIssues.join(', ')}`);

                if (validationIssues.some(i => i.includes('Missing required sections'))) {
                    logger.warn(`Script structure invalid, trying next model.`);
                    logger.debug(`Malformed output (first 200 chars): ${script.substring(0, 200)}...`);
                    throw new Error(`Output validation failed: ${validationIssues.join(', ')}`);
                }
            }

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

    logger.error('All script generation models failed.');
    throw lastError || new Error('Script generation failed');
}

// ============================================
// Script Validation
// ============================================

function validateScript(script: string): string[] {
    const issues: string[] = [];

    const bannedPhrases = [
        'in this video',
        'hey guys',
        'let me tell you',
        'so basically',
        'and that\'s it',
        'hope this helps'
    ];

    const lowerScript = script.toLowerCase();
    for (const phrase of bannedPhrases) {
        if (lowerScript.includes(phrase)) {
            issues.push(`Banned phrase: "${phrase}"`);
        }
    }

    const becauseCount = (script.match(/because/gi) || []).length;
    if (becauseCount > 3) {
        issues.push(`Excessive "because" (${becauseCount}x)`);
    }

    // Flexible validation: Accept both standard [BODY] and storytelling formats with [BODY - PART 1]/[BODY - PART 2]
    const hasHook = script.includes('[HOOK]');
    const hasBody = script.includes('[BODY]') ||
        (script.includes('[BODY - PART 1]') && script.includes('[BODY - PART 2]'));
    const hasCTA = script.includes('[CTA]');

    if (!hasHook || !hasBody || !hasCTA) {
        issues.push('Missing required sections [HOOK]/[BODY]/[CTA]');
    }

    return issues;
}

// ============================================
// One-Shot Generator
// ============================================

export async function generateScriptFromVideo(options: OneShotGeneratorOptions): Promise<string> {
    const { userIdea, frames, audioPath } = options;

    const mediaParts: Part[] = [];

    // FIXED: Simpler file existence check
    if (frames && frames.length > 0) {
        const existingFrames = frames.filter(f => fs.existsSync(f));
        const selectedFrames = existingFrames.slice(0, 6);

        const framePromises = selectedFrames.map(f => fileToGenerativePart(f, 'image/jpeg'));
        mediaParts.push(...await Promise.all(framePromises));
    }

    if (audioPath && fs.existsSync(audioPath)) {
        mediaParts.push(await fileToGenerativePart(audioPath, 'audio/wav'));
    }

    const referenceDNA = `[VIDEO/AUDIO ATTACHED]
Analyze frames and audio directly.
Extract: pacing, tone, hook psychology, language style.
THIS IS YOUR REFERENCE DNA.`;

    const safeTranscript = truncateTranscript(options.transcript);
    const detectedLang = detectTranscriptLanguage(safeTranscript);
    const languageOverride = options.languageHint;

    // Pass isRemix flag so prompt preserves original topic instead of changing it
    const masterPrompt = createMasterPrompt(userIdea, referenceDNA, detectedLang, languageOverride, options.isRemix);
    const optionalHints = buildOptionalHints(options);

    let priorContext = '';
    if (options.previousScripts && options.previousScripts.length > 0) {
        const relevantScripts = options.previousScripts.slice(-2);
        priorContext = `\n--- PRIOR SCRIPTS ---\n` +
            relevantScripts.map((ps, i) => `${i + 1}. ${ps.script}`).join('\n');
    }

    const fullPrompt = masterPrompt + priorContext + optionalHints;

    const modelName = 'gemini-2.0-flash-001';  // FIXED: Correct model name

    try {
        logger.info(`One-Shot generation with ${modelName}`);

        const model = vertexAI.getGenerativeModel({
            model: modelName,
            systemInstruction: "You are a Viral Script Writer studying human conversation patterns.",
            generationConfig: {
                maxOutputTokens: 1500,  // FIXED: Full script capacity
                temperature: 0.9,
                topP: 0.95,
            }
        });

        const contentParts: Part[] = [
            { text: fullPrompt },
            ...mediaParts,
        ];

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: contentParts }],
        });

        const script = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '';

        const validationIssues = validateScript(script);
        if (validationIssues.length > 0) {
            logger.warn(`One-Shot validation warnings: ${validationIssues.join(', ')}`);
            if (validationIssues.some(i => i.includes('Missing required sections'))) {
                logger.debug(`Malformed one-shot output: ${script.substring(0, 200)}...`);
                throw new Error(`Output validation failed: ${validationIssues.join(', ')}`);
            }
        }

        return script.trim();

    } catch (error: any) {
        logger.error(`One-Shot generation failed: ${error.message}`);
        throw error;
    }
}

// ============================================
// Master Prompt Builder
// ============================================

function createMasterPrompt(
    userIdea: string,
    referenceDNA: string,
    detectedLang: DetectedLanguage,
    languageOverride?: string,
    isRemix?: boolean  // NEW: Flag to preserve original topic
): string {
    const effectiveLanguage = languageOverride || detectedLang.language;
    const isRomanized = !languageOverride && detectedLang.isRomanized;

    const languageSection = `
🔒 LANGUAGE DETECTION
═══════════════════════════════════════════════════════════════════════
DETECTED: ${detectedLang.language}${detectedLang.sampleWords.length > 0 ? ` (${detectedLang.sampleWords.join(', ')})` : ''}
OUTPUT: ${effectiveLanguage}${isRomanized ? ' (ROMANIZED A-Z)' : ''}

RULES:
• Hindi/Arabic/Tamil → Roman alphabet (A-Z)
  Example: "Aap yeh galti mat karo" NOT "आप यह"
• Labels (🎬 📝) → Always English
• Dialogue (💬 SAY) → ${effectiveLanguage}
• NO script mixing
• When unsure → Default to English
═══════════════════════════════════════════════════════════════════════
`;

    // NEW: Remix mode section - tells AI to preserve topic but REIMAGINE delivery
    const remixSection = isRemix ? `
═══════════════════════════════════════════════════════════════════════
🔄 REMIX MODE - SAME TOPIC, FRESH DELIVERY
═══════════════════════════════════════════════════════════════════════

You are REIMAGINING an existing script. Keep the TOPIC but make it BETTER.

KEEP THE SAME:
✅ Core topic/subject (if about music taste → stay on music taste)
✅ Main message and key points
✅ Any specific names (people, apps, products mentioned)

COMPLETELY REWRITE:
🔥 The HOOK - make it 10x more attention-grabbing, punchy, scroll-stopping
🔥 Word choices - use fresher, punchier language (don't copy original phrases)
🔥 Sentence structure - vary rhythm, add contrast, create flow
🔥 Delivery angle - find a more engaging way to present the same info
🔥 CTA - make it compelling and actionable

THINK OF IT LIKE THIS:
→ Original: "I'm done gatekeeping my music taste, here's a list..."
→ Remix: "The algorithm tried to hide these from you. My top 5 secret weapons..."

→ Original: "Number 5 is Ritviz. He has funky beats..."
→ Remix: "First up, Ritviz. This guy's beats hit DIFFERENT..."

THE GOAL:
Same topic + Same key info + COMPLETELY FRESH WORDING = Scroll-stopping content

DO NOT:
❌ Change the topic to something unrelated
❌ Remove the key points/facts
❌ Just copy-paste the original with minor tweaks (BORING!)
❌ Change names of people/products mentioned

═══════════════════════════════════════════════════════════════════════
` : '';

    // Use different framing for remix vs new concept
    const conceptLabel = isRemix ? 'REMIX REQUEST' : 'NEW CONCEPT';
    const transformResult = isRemix
        ? 'SAME topic as the reference, but with IMPROVED delivery, structure, and engagement.'
        : 'Same CREATOR vibe, different TOPIC.';

    return `${languageSection}
${remixSection}
REFERENCE VIDEO DATA:
${referenceDNA}

${conceptLabel}: "${userIdea}"

═══════════════════════════════════════════════════════════════════════
🎨 STEAL LIKE AN ARTIST FRAMEWORK
═══════════════════════════════════════════════════════════════════════

"Good artists copy. Great artists STEAL." - Picasso
You're stealing the PSYCHOLOGY, not the words.

PHASE 1: DECODE THE REFERENCE
─────────────────────────────────────────────────────────────────────
Extract from Reference Data above:

1. HOOK EMOTION → What feeling does it trigger?
   (Fear, curiosity, shock, FOMO, validation, anger)

2. TENSION PATTERN → How does interest build?
   (Problem→Solution / Myth→Truth / Story→Lesson / Before→After)

3. RHYTHM → Fast punchy or slow dramatic?
   (Count words per sentence to match pace)

4. CREDIBILITY → Why should anyone listen?
   (Stats, personal results, expertise, relatability)

5. VOCABULARY → What insider language is used?
   (Niche terms, slang, technical jargon)

─────────────────────────────────────────────────────────────────────
PHASE 2: ${isRemix ? 'IMPROVE THE DELIVERY' : 'TRANSPLANT TO NEW CONCEPT'}
─────────────────────────────────────────────────────────────────────

STEAL THESE:
✅ Opening emotion trigger
✅ Story building pattern
✅ Speech rhythm and pacing
✅ Trust-building style
✅ Vocabulary sophistication level

DON'T STEAL THESE:
❌ Exact words or phrases
${isRemix ? '✅ Keep specific examples and facts from original' : '❌ Specific examples'}
${isRemix ? '✅ Keep original topic details' : '❌ Topic details'}

RESULT: ${transformResult}

═══════════════════════════════════════════════════════════════════════
🎣 HOOK ENGINEERING (First 3 Words Rule)
═══════════════════════════════════════════════════════════════════════

First 3 words MUST stop the scroll. Choose ONE archetype:

HIGH-IMPACT (Use 80% of time):
1. 💥 SHOCK STAT → "97% of creators fail..."
2. 🚫 STOP COMMAND → "Stop posting daily..."
3. 💸 LOSS WARNING → "You're losing $10K monthly..."
4. 🤫 INSIDER SECRET → "Nobody tells you this..."
5. ⚠️ URGENT FIX → "Your hook kills engagement..."
6. 🎯 IDENTITY CALL → "If you're under 10K followers..."

MEDIUM-IMPACT (Use 20% of time):
7. 🔍 MYTH BUSTER → "Consistency beats quality? Wrong."
8. 📈 TRANSFORMATION → "I went from 0 to 100K..."
9. 🎭 STORY OPEN → "I was quitting when..."

NEVER USE:
❌ "Have you ever...?" → Passive
❌ "Hey guys..." → Wastes time
❌ "I'm going to show you..." → Delays value

═══════════════════════════════════════════════════════════════════════
⏱️ PACING GUARDRAIL (Natural Speaking Speed)
═══════════════════════════════════════════════════════════════════════

Humans speak at ~150 words/minute = 2.5 words/second with natural pauses.

WORD COUNT LIMITS:
[HOOK] Maximum 12 words (fits in 5 seconds with impact)
[BODY] Maximum 60-75 words (fits in 25-30 seconds)
[CTA] Maximum 15 words (fits in 6 seconds)

Total script: 90-100 words = 35-40 seconds of natural speech.

If HOOK exceeds 12 words, viewer scrolls. Keep it PUNCHY.
Exceeding these limits causes immediate generation failure.

═══════════════════════════════════════════════════════════════════════
💬 NATURAL DIALOGUE (Anti-Robotic Framework)
═══════════════════════════════════════════════════════════════════════

RULE 1: THOUGHT UNITS (Short-Long-Short Rhythm)
People speak in chunks with natural pauses.

Pattern:
Short (3-5 words) → Punch
Long (8-12 words) → Explanation
Short (4-6 words) → Transition

Example:
"Your hook is dead. (3 words)
Most creators front-load fluff, so viewers scroll instantly. (9 words)
Fix the opening. Everything changes. (5 words)"

─────────────────────────────────────────────────────────────────────
RULE 2: CONVERSATIONAL CONNECTORS

START WITH:
✅ "Look..." / "Listen..." / "Real talk..." / "Here's the thing..."

TRANSITIONS:
✅ "But here's the catch..." / "Translation?" / "What changed?"

EMPHASIS:
✅ "Not just [X]. [Y]." → Creates contrast
✅ "[Statement]. Period." → Adds authority
✅ "The problem? [Issue]." → Self-Q&A

─────────────────────────────────────────────────────────────────────
RULE 3: NATURAL EXPLANATIONS (No Forced "Because")

Instead of: "X happens BECAUSE Y"
Use:
✅ "X happens. Why? Y." (Self-Q&A)
✅ "X happens. The reason? Y." (Reveal)
✅ "X happens - Y is the culprit." (Dash connector)

Example:
❌ Robotic: "Videos fail because hooks lack emotional triggers."
✅ Natural: "Videos fail. The reason? Hooks don't trigger emotion."

─────────────────────────────────────────────────────────────────────
RULE 4: ALWAYS USE CONTRACTIONS

✅ "I'm", "you're", "don't", "can't", "here's", "that's"
❌ "I am", "you are", "do not", "cannot", "here is", "that is"

═══════════════════════════════════════════════════════════════════════
🚫 BANNED PHRASES (Instant Engagement Killers)
═══════════════════════════════════════════════════════════════════════

NEVER START WITH:
❌ "In this video..." → Wastes 3 words
❌ "Hey guys, so today..." → Generic cliché
❌ "I want to talk about..." → Passive
❌ "So basically..." → Filler
❌ "Let me tell you..." → Lecture tone
❌ "Okay so..." → Uncertain

NEVER SAY MID-SCRIPT:
❌ "You might be wondering..." → Assumes
❌ "Trust me when I say..." → Desperate
❌ "It's important to understand..." → Essay language
❌ "The thing is..." → Vague
❌ "As you can see..." → Obvious

NEVER END WITH:
❌ "...and that's it." → Flat
❌ "Hope this helps!" → Passive
❌ "See you next time!" → Assumes
❌ "Peace out!" → Tryhard

OVERUSED BUZZWORDS (avoid):
❌ "Game changer" → Meaningless
❌ "Next level" → Vague
❌ "Literally" (when not literal) → Annoying
❌ "Crazy" / "Insane" → Lazy emphasis
❌ "Secret" / "Hack" (overused) → Only if genuinely unknown

═══════════════════════════════════════════════════════════════════════
📐 OUTPUT FORMAT (Exact Structure)
═══════════════════════════════════════════════════════════════════════

SHORT SCRIPT (25-40 seconds):

[HOOK]
🎬 VISUAL: [Camera: Shot type, angle | Face: Expression | Hands: Gesture | Light: Type]
📝 TEXT OVERLAY: "[3-5 WORDS MAX - CAPS]"
💬 SAY: "[First 3 words STOP scroll]. [Build tension max 12 words total]."

[BODY]
🎬 VISUAL: [Camera: New angle | Face: New expression | Hands: Different gesture | Movement: Zoom/pan if any]
📝 TEXT OVERLAY: "[KEY POINT #1 - 3-5 WORDS]"
💬 SAY: "[Main insight]. [Why it matters]. [Quick punch]."

🎬 VISUAL: [Camera: Another angle | Face: Different look | Hands: New gesture]
📝 TEXT OVERLAY: "[KEY POINT #2 - 3-5 WORDS]"
💬 SAY: "[Second insight]. [Connection to first]. [Emphasis]."

[CTA]
🎬 VISUAL: [Camera: Close-up | Face: Confident smile | Hands: Action gesture]
📝 TEXT OVERLAY: "[ACTION: FOLLOW/SAVE/TRY]"
💬 SAY: "[What to do NOW]. [Bonus reason]."

═══════════════════════════════════════════════════════════════════════
🎬 VISUAL DIRECTION STANDARDS (Realistic & Specific)
═══════════════════════════════════════════════════════════════════════

CRITICAL: You're directing a SOLO CREATOR with ONE SMARTPHONE.
Do NOT invent impossible Hollywood camera movements.
Only use realistic transitions: jump cuts, static framing, handheld.
B-Roll must be easily filmable at home or office.

For EVERY 🎬 VISUAL, include ALL:

CAMERA SETUP:
✓ Shot: "Close-up face" / "Medium waist-up" / "Wide full-body"
✓ Angle: "Eye level" / "10° above" / "Low angle up"
✓ Distance: "2 feet from lens" / "Arm's length" / "6 feet back"

SUBJECT:
✓ Face: "Eyebrows raised, smirk" / "Serious, jaw set"
✓ Eyes: "Direct to camera" / "Looking off-left"
✓ Hands: "Counting fingers" / "Arms crossed" / "Pointing"
✓ Body: "Leaning forward 15°" / "Standing straight"

MOVEMENT (only realistic ones):
✓ Camera: "Static - no movement" / "Slow zoom 20% on 'secret'"
✓ Subject: "Step forward mid-sentence" / "Gesture on beat"

LIGHT:
✓ Type: "Bright ring light" / "Natural window" / "Moody spotlight"
✓ Mood: "High-key energetic" / "Low-key serious" / "Neutral"

BACKGROUND:
✓ "White wall" / "Blurred office" / "Bookshelf visible"

─────────────────────────────────────────────────────────────────────
TEXT OVERLAY SPECS:
✓ 3-5 words MAX (shorter = more impact)
✓ Action verbs: "STOP THIS" / "3 SECRETS" / "THE TRUTH"
✓ Position: "Top-center" / "Bottom-third" (if critical)

═══════════════════════════════════════════════════════════════════════
🎯 NICHE ADAPTATION (Match Audience)
═══════════════════════════════════════════════════════════════════════

BUSINESS/FINANCE:
- Words: Data, ROI, profit, margins, CAC, LTV
- Speed: Moderate (clear, confident)
- Trust: Numbers, case studies, frameworks
- Example: "Your CAC is killing margins..."

FITNESS/HEALTH:
- Words: Transform, gains, shred, recovery, form
- Speed: Fast (high energy)
- Trust: Before/after, personal results, science
- Example: "Your form kills gains..."

TECH/CODING:
- Words: Efficient, algorithm, API, optimize, O(n)
- Speed: Medium-fast (respect their time)
- Trust: Code examples, benchmarks
- Example: "This is O(n²). Here's O(n)..."

LIFESTYLE/CREATIVE:
- Words: Routine, mindset, vibe, aesthetic, journey
- Speed: Variable (slow builds, fast punches)
- Trust: Personal stories, emotions
- Example: "I hated mornings. Then..."

EDUCATION/LEARNING:
- Words: Simple, understand, master, apply, learn
- Speed: Medium (allow comprehension)
- Trust: Step-by-step, simplifying complex
- Example: "Think of it like this..."

═══════════════════════════════════════════════════════════════════════
✅ QUALITY CHECKLIST (Run Before Finalizing)
═══════════════════════════════════════════════════════════════════════

HOOK:
☐ First 3 words stop scroll (not "Hey guys...")
☐ Triggers ONE emotion (fear/curiosity/shock/FOMO)
☐ Under 12 words total
☐ Visual matches energy

BODY:
☐ Uses short-long-short rhythm
☐ NO banned phrases
☐ Natural connectors ("Look...", "Here's the thing...")
☐ Specific examples ("10K views" not "many views")
☐ Camera angles change between points
☐ Under 75 words total

NATURAL SOUND:
☐ Sounds normal if spoken aloud
☐ Uses contractions ("I'm" not "I am")
☐ No robot talk
☐ Explanations flow naturally (no forced "because because")

CTA:
☐ Clear action (Follow/Save/Try)
☐ Creates urgency or teases next video
☐ Confident (not "hope this helps")
☐ Under 15 words total

TECHNICAL:
☐ Dialogue in correct language
☐ All scenes have camera + face + hands + light
☐ Text overlays 3-5 words max
☐ No emojis in dialogue
☐ No hashtags
☐ Only realistic camera movements (solo creator with phone)

NICHE:
☐ Vocabulary matches audience
☐ Speed fits content type
☐ Trust signals fit topic

`;
}
