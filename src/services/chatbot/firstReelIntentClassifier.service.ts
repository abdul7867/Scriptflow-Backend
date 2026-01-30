/**
 * User Intent Classification for First Reel Interaction
 * 
 * Determines whether user wants to:
 * - TRANSFORM_ORIGINAL: Remix/enhance the original reel's script
 * - CREATE_NEW: Generate a fresh script with new topic/angle
 * - ENHANCE_ORIGINAL: Improve original quality (smart inference)
 * 
 * @author ScriptFlow Team
 * @version 1.0.0
 */

import { logger } from '../../utils/logger';

// ═══════════════════════════════════════════════════════════════════════════
// USER INTENT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export enum FirstReelIntent {
    /** User wants to create a completely new script with new topic/angle */
    CREATE_NEW = 'CREATE_NEW',

    /** User wants to transform/remix the original reel (keep style, change length/tone) */
    TRANSFORM_ORIGINAL = 'TRANSFORM_ORIGINAL',

    /** User wants to enhance original quality (remove filler, strengthen hooks) */
    ENHANCE_ORIGINAL = 'ENHANCE_ORIGINAL',
}

export interface IntentClassificationResult {
    intent: FirstReelIntent;
    confidence: 'high' | 'medium' | 'low';
    extractedIdea: string | null;
    reasoning: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// KEYWORD PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

/** Topics that indicate CREATE_NEW intent */
const CREATIVE_TOPICS = [
    // Niches
    'fitness', 'workout', 'gym', 'exercise', 'health',
    'cooking', 'recipe', 'food', 'meal prep',
    'business', 'startup', 'entrepreneur', 'saas', 'marketing',
    'tech', 'ai', 'programming', 'coding', 'software',
    'motivation', 'mindset', 'productivity', 'self-improvement',
    'finance', 'money', 'investing', 'trading',
    'fashion', 'style', 'beauty', 'skincare',
    'travel', 'adventure', 'vacation',
    'education', 'learning', 'study', 'teaching',

    // Angles
    'for beginners', 'advanced', 'tips for', 'how to',
    'mistakes', 'secrets', 'hacks', 'tricks',
];

/** Transformation keywords that indicate TRANSFORM_ORIGINAL intent */
const TRANSFORMATION_KEYWORDS = [
    // Length modifications
    'shorter', 'longer', 'brief', 'condensed', 'compact',
    'detailed', 'expanded', 'extended', 'quick', 'fast',

    // Style modifications  
    'remix', 'rework', 'revise', 'transform', 'modify',
    'funnier', 'serious', 'casual', 'professional',
    'edgy', 'friendly', 'formal', 'informal',
    'punchy', 'snappy', 'dramatic', 'engaging',
    'simpler', 'clearer', 'straightforward',
];

/** Enhancement keywords (could be either mode) */
const ENHANCEMENT_KEYWORDS = [
    'better', 'improve', 'enhance', 'optimize',
    'more engaging', 'more interesting', 'catchier',
    'stronger', 'more powerful', 'more effective',
];

// ═══════════════════════════════════════════════════════════════════════════
// CLASSIFICATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if message contains specific creative topic or angle
 */
function containsCreativeTopic(message: string): boolean {
    const normalized = message.toLowerCase();

    return CREATIVE_TOPICS.some(topic => {
        // Match whole words or phrases
        const regex = new RegExp(`\\b${topic.replace(/\s+/g, '\\s+')}\\b`, 'i');
        return regex.test(normalized);
    });
}

/**
 * Check if message contains transformation keywords
 */
function containsTransformationKeyword(message: string): boolean {
    const normalized = message.toLowerCase();

    return TRANSFORMATION_KEYWORDS.some(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        return regex.test(normalized);
    });
}

/**
 * Check if message contains enhancement keywords
 */
function containsEnhancementKeyword(message: string): boolean {
    const normalized = message.toLowerCase();

    return ENHANCEMENT_KEYWORDS.some(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        return regex.test(normalized);
    });
}

/**
 * Extract user idea from message (remove URLs and generic phrases)
 */
function extractIdeaText(message: string): string {
    // Remove Instagram URLs
    let idea = message.replace(/https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/[^\s]*/gi, '');

    // Remove generic command phrases
    idea = idea.replace(/^(make|create|generate|write|do)\s+(this|it|a|an)?\s*/i, '');
    idea = idea.replace(/^(about|for|on)\s+/i, '');

    return idea.trim();
}

/**
 * Check if idea text is substantive (not just keywords)
 */
function hasSubstantiveIdea(ideaText: string): boolean {
    // After removing transformation keywords, is there still content?
    let remaining = ideaText.toLowerCase();

    // Remove all transformation keywords
    for (const keyword of TRANSFORMATION_KEYWORDS) {
        remaining = remaining.replace(new RegExp(`\\b${keyword}\\b`, 'gi'), '');
    }

    remaining = remaining.trim();

    // If 3+ words remain, it's substantive
    const wordCount = remaining.split(/\s+/).filter(w => w.length > 0).length;
    return wordCount >= 3;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CLASSIFICATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Classify user's intent for first reel interaction
 * 
 * @param message - User's message (may include reel URL)
 * @returns Classification result with intent, confidence, and reasoning
 */
export function classifyFirstReelIntent(message: string): IntentClassificationResult {
    const ideaText = extractIdeaText(message);

    logger.debug('[IntentClassifier] Analyzing first reel intent', {
        originalMessage: message,
        extractedIdea: ideaText,
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // RULE 1: Creative Topic Mentioned → CREATE_NEW (HIGH CONFIDENCE)
    // ═══════════════════════════════════════════════════════════════════════════

    if (containsCreativeTopic(ideaText)) {
        logger.info('[IntentClassifier] Creative topic detected → CREATE_NEW', {
            idea: ideaText,
        });

        return {
            intent: FirstReelIntent.CREATE_NEW,
            confidence: 'high',
            extractedIdea: ideaText,
            reasoning: 'Specific creative topic or angle detected',
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RULE 2: Transformation Keyword + No Substantive Idea → TRANSFORM_ORIGINAL
    // ═══════════════════════════════════════════════════════════════════════════

    if (containsTransformationKeyword(ideaText) && !hasSubstantiveIdea(ideaText)) {
        logger.info('[IntentClassifier] Pure transformation keyword → TRANSFORM_ORIGINAL', {
            idea: ideaText,
        });

        return {
            intent: FirstReelIntent.TRANSFORM_ORIGINAL,
            confidence: 'high',
            extractedIdea: ideaText,
            reasoning: 'Transformation keyword without new topic',
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RULE 3: Enhancement Keyword Only → ENHANCE_ORIGINAL (MEDIUM CONFIDENCE)
    // ═══════════════════════════════════════════════════════════════════════════

    if (containsEnhancementKeyword(ideaText) && !hasSubstantiveIdea(ideaText)) {
        logger.info('[IntentClassifier] Enhancement keyword → ENHANCE_ORIGINAL', {
            idea: ideaText,
        });

        return {
            intent: FirstReelIntent.ENHANCE_ORIGINAL,
            confidence: 'medium',
            extractedIdea: ideaText,
            reasoning: 'Generic enhancement request',
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RULE 4: Empty/Vague Idea → CREATE_NEW (LOW CONFIDENCE)
    // ═══════════════════════════════════════════════════════════════════════════

    if (!ideaText || ideaText.length < 3) {
        logger.info('[IntentClassifier] Empty idea → CREATE_NEW (default)', {
            idea: ideaText,
        });

        return {
            intent: FirstReelIntent.CREATE_NEW,
            confidence: 'low',
            extractedIdea: null,
            reasoning: 'No clear instruction, will infer from reel content',
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DEFAULT: CREATE_NEW (MEDIUM CONFIDENCE)
    // ═══════════════════════════════════════════════════════════════════════════

    logger.info('[IntentClassifier] Default to CREATE_NEW', {
        idea: ideaText,
    });

    return {
        intent: FirstReelIntent.CREATE_NEW,
        confidence: 'medium',
        extractedIdea: ideaText,
        reasoning: 'No clear transformation keywords, treating as creative request',
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determine which pattern DNA to use for remix based on original intent
 */
export function getPatternDNATypeForRemix(originalIntent: FirstReelIntent): 'original' | 'generated' {
    switch (originalIntent) {
        case FirstReelIntent.TRANSFORM_ORIGINAL:
        case FirstReelIntent.ENHANCE_ORIGINAL:
            return 'original'; // Use creator's authentic style

        case FirstReelIntent.CREATE_NEW:
        default:
            return 'generated'; // Use our generated script's style
    }
}
