/**
 * Preference Extractor Utility
 * 
 * Extracts user preferences (language, tone) from their idea/prompt text.
 * This allows users to specify preferences naturally in their message like:
 * - "Coffee tips in Hindi"
 * - "Make it funny - fitness motivation"
 * - "Professional business script about marketing"
 * 
 * DESIGN PRINCIPLES:
 * 1. Non-intrusive - enhances existing system, doesn't replace
 * 2. Explicit user intent > auto-detection > defaults
 * 3. Preserves original idea after extraction
 * 
 * @author ScriptFlow Team
 * @version 1.0.0
 */

import { logger } from './logger';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ToneHint = 'professional' | 'funny' | 'provocative' | 'educational' | 'casual';

export interface ExtractedPreferences {
    /** Language explicitly requested by user (e.g., "Hindi", "Spanish") */
    languageHint?: string;
    /** Tone explicitly requested by user */
    toneHint?: ToneHint;
    /** Cleaned idea with preference keywords removed for cleaner AI input */
    cleanedIdea: string;
    /** Whether any preferences were explicitly extracted */
    hasExplicitPreferences: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// LANGUAGE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Supported languages and their variations
 * Includes both romanized forms and common misspellings
 */
const LANGUAGE_MAP: Record<string, string> = {
    // Hindi
    'hindi': 'Hindi',
    'hinglish': 'Hindi',
    'roman hindi': 'Hindi',
    'romanized hindi': 'Hindi',

    // English variations
    'english': 'English',
    'eng': 'English',

    // South Indian languages
    'kannada': 'Kannada',
    'tamil': 'Tamil',
    'telugu': 'Telugu',
    'malayalam': 'Malayalam',

    // Other Indian languages
    'bengali': 'Bengali',
    'bangla': 'Bengali',
    'marathi': 'Marathi',
    'gujarati': 'Gujarati',
    'punjabi': 'Punjabi',

    // Urdu/Arabic
    'urdu': 'Urdu',
    'arabic': 'Arabic',

    // Common international
    'spanish': 'Spanish',
    'french': 'French',
    'german': 'German',
    'portuguese': 'Portuguese',
    'italian': 'Italian',
    'japanese': 'Japanese',
    'korean': 'Korean',
    'chinese': 'Chinese',
    'russian': 'Russian',
};

/**
 * Patterns to detect language requests in user ideas
 * Order matters - more specific patterns first
 */
const LANGUAGE_PATTERNS: RegExp[] = [
    // "in Hindi", "in English", etc.
    /\b(?:in|using|write\s+in|give\s+(?:me\s+)?in|script\s+in|make\s+(?:it\s+)?in)\s+([a-zA-Z]+)\b/i,

    // "Hindi me", "Hindi mein" (romanized request)
    /\b([a-zA-Z]+)\s+(?:me|mein|main|mai)\b/i,

    // "Hindi script", "English version"
    /\b([a-zA-Z]+)\s+(?:script|version|language)\b/i,

    // Just the language at the end: "...coffee tips Hindi"
    /\b([a-zA-Z]+)$/i,
];

/**
 * Extract language preference from user idea
 */
function extractLanguage(idea: string): { language?: string; cleanedText: string } {
    const lowerIdea = idea.toLowerCase();

    for (const pattern of LANGUAGE_PATTERNS) {
        const match = idea.match(pattern);
        if (match && match[1]) {
            const detectedLang = match[1].toLowerCase();
            const normalizedLang = LANGUAGE_MAP[detectedLang];

            if (normalizedLang) {
                // Remove the language part from the idea
                const cleanedText = idea.replace(pattern, '').trim();
                return { language: normalizedLang, cleanedText };
            }
        }
    }

    // No explicit language found
    return { cleanedText: idea };
}

// ═══════════════════════════════════════════════════════════════════════════
// TONE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tone patterns - keywords that indicate user's desired tone
 * Maps keywords to the corresponding ToneHint enum value
 */
const TONE_PATTERNS: Record<ToneHint, RegExp[]> = {
    funny: [
        /\b(?:funny|humorous|witty|comedic|hilarious|make\s*(?:me|it)\s*laugh|comedy|joke|jokes|lol|lmao)\b/i,
        /\b(?:sarcastic|sarcasm|ironic|irony)\b/i,
    ],
    professional: [
        /\b(?:professional|formal|business|corporate|serious|executive)\b/i,
        /\b(?:linkedin|b2b|enterprise)\b/i,
    ],
    provocative: [
        /\b(?:edgy|provocative|controversial|bold|spicy|hot\s*take|unpopular\s*opinion)\b/i,
        /\b(?:aggressive|in\s*your\s*face|confrontational)\b/i,
    ],
    educational: [
        /\b(?:educational|informative|teach|teaching|explain|explaining|tutorial|how[\s-]*to|step[\s-]*by[\s-]*step)\b/i,
        /\b(?:learn|learning|lesson|guide|walkthrough)\b/i,
    ],
    casual: [
        /\b(?:casual|chill|relaxed|conversational|friendly|laid[\s-]*back|easy[\s-]*going)\b/i,
        /\b(?:vibe|vibes|relatable)\b/i,
    ],
};

/**
 * Keywords that indicate tone preference but should be removed from the idea
 */
const TONE_REMOVAL_PATTERNS: RegExp[] = [
    /\b(?:make\s+it|keep\s+it|go|be)\s+(?:funny|professional|edgy|educational|casual|provocative)\b/i,
    /\b(?:in\s+a?\s*(?:funny|professional|edgy|educational|casual|provocative)\s+(?:way|style|tone|manner))\b/i,
    /\b(?:(?:funny|professional|edgy|educational|casual|provocative)\s+(?:style|tone|vibe))\b/i,
];

/**
 * Extract tone preference from user idea
 */
function extractTone(idea: string): { tone?: ToneHint; cleanedText: string } {
    // Check each tone pattern
    for (const [tone, patterns] of Object.entries(TONE_PATTERNS) as [ToneHint, RegExp[]][]) {
        for (const pattern of patterns) {
            if (pattern.test(idea)) {
                // Remove tone-related phrases from the idea
                let cleanedText = idea;
                for (const removePattern of TONE_REMOVAL_PATTERNS) {
                    cleanedText = cleanedText.replace(removePattern, '');
                }
                cleanedText = cleanedText.trim();

                return { tone, cleanedText };
            }
        }
    }

    // No explicit tone found
    return { cleanedText: idea };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXTRACTOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract all user preferences from their idea text
 * 
 * @param userIdea - Raw user input
 * @returns Extracted preferences and cleaned idea
 * 
 * @example
 * extractPreferencesFromIdea("Coffee tips in Hindi")
 * // => { languageHint: "Hindi", cleanedIdea: "Coffee tips", hasExplicitPreferences: true }
 * 
 * extractPreferencesFromIdea("Make it funny - fitness motivation")
 * // => { toneHint: "funny", cleanedIdea: "fitness motivation", hasExplicitPreferences: true }
 */
export function extractPreferencesFromIdea(userIdea: string): ExtractedPreferences {
    if (!userIdea || userIdea.trim().length === 0) {
        return {
            cleanedIdea: userIdea || '',
            hasExplicitPreferences: false,
        };
    }

    let workingText = userIdea.trim();
    let languageHint: string | undefined;
    let toneHint: ToneHint | undefined;

    // Extract language first (often at the end)
    const langResult = extractLanguage(workingText);
    if (langResult.language) {
        languageHint = langResult.language;
        workingText = langResult.cleanedText;
    }

    // Then extract tone
    const toneResult = extractTone(workingText);
    if (toneResult.tone) {
        toneHint = toneResult.tone;
        workingText = toneResult.cleanedText;
    }

    // Clean up any leftover punctuation and whitespace
    const cleanedIdea = workingText
        .replace(/^\s*[-–—:,;]\s*/, '') // Remove leading punctuation
        .replace(/\s*[-–—:,;]\s*$/, '') // Remove trailing punctuation
        .replace(/\s{2,}/g, ' ')        // Collapse multiple spaces
        .trim();

    const hasExplicitPreferences = !!(languageHint || toneHint);

    // Log extraction for debugging (only if preferences were found)
    if (hasExplicitPreferences) {
        logger.info('[PreferenceExtractor] Extracted user preferences', {
            original: userIdea.substring(0, 100),
            languageHint,
            toneHint,
            cleanedIdea: cleanedIdea.substring(0, 100),
        });
    }

    return {
        languageHint,
        toneHint,
        cleanedIdea: cleanedIdea || userIdea, // Fallback to original if cleaning produced empty string
        hasExplicitPreferences,
    };
}

/**
 * Merge extracted preferences with any existing hints
 * 
 * Priority: Explicit user request (from idea) > ManyChat field > Default
 * 
 * @param extracted - Preferences extracted from user idea
 * @param existingToneHint - Tone hint from ManyChat field (if any)
 * @param existingLanguageHint - Language hint from ManyChat field (if any)
 */
export function mergePreferences(
    extracted: ExtractedPreferences,
    existingToneHint?: ToneHint | string,
    existingLanguageHint?: string
): {
    finalToneHint?: ToneHint;
    finalLanguageHint?: string;
    finalIdea: string;
} {
    // Priority: Extracted (explicit user request) > Existing (ManyChat field)
    const finalToneHint = extracted.toneHint || (existingToneHint as ToneHint | undefined);
    const finalLanguageHint = extracted.languageHint || existingLanguageHint;

    return {
        finalToneHint,
        finalLanguageHint,
        finalIdea: extracted.cleanedIdea,
    };
}
