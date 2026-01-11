/**
 * Deterministic Intent Classifier
 * 
 * A pure rule-based, deterministic intent classifier for chatbot messages.
 * NO AI, NO probabilistic logic - pure pattern matching and state-based rules.
 * 
 * @author ScriptFlow Team
 * @version 1.0.0
 */

import { ChatbotState } from './chatbotStateMachine.service';

// ═══════════════════════════════════════════════════════════════════════════
// INTENT ENUM
// ═══════════════════════════════════════════════════════════════════════════

export enum UserIntent {
    NEW_REEL = 'NEW_REEL',
    SUBMIT_IDEA = 'SUBMIT_IDEA',
    VARIATION = 'VARIATION',
    COPY = 'COPY',
    EXTRACT_ORIGINAL = 'EXTRACT_ORIGINAL',
    HELP = 'HELP',
    INVALID = 'INVALID',
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSIFICATION RESULT
// ═══════════════════════════════════════════════════════════════════════════

export interface ClassificationResult {
    intent: UserIntent;
    reason: string;
    extractedData: {
        reelUrl?: string;
        normalizedMessage?: string;
        userIdea?: string;
    };
    matchedRule: string;
    validForState: boolean;
    validInStates?: ChatbotState[];
}

// ═══════════════════════════════════════════════════════════════════════════
// URL PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

const REEL_URL_PATTERNS: RegExp[] = [
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/reel\/([A-Za-z0-9_-]+)\/?/i,
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/reels\/([A-Za-z0-9_-]+)\/?/i,
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/p\/([A-Za-z0-9_-]+)\/?/i,
    /(?:https?:\/\/)?instagr\.am\/reel\/([A-Za-z0-9_-]+)\/?/i,
    /(?:https?:\/\/)?instagr\.am\/p\/([A-Za-z0-9_-]+)\/?/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// KEYWORD PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

const VARIATION_KEYWORDS: string[] = [
    // Redo/retry variations
    'redo', 'again', 'another', 'different', 'variation', 'new version',
    'try again', 'regenerate', 'rewrite', 'remake', 'retry', 'once more',
    'one more', 'another one', 'make another', 'give me another',
    'create another', 'generate another', 'do it again', 'do again',
    'more', 'next', 'alternative', 'alt',
    // Remix keywords (user wants to change the style)
    'remix', 'rework', 'revise', 'modify', 'change', 'edit',
    // Specific modifications
    'shorter', 'longer', 'funnier', 'serious', 'casual', 'professional',
    'simpler', 'detailed', 'engaging', 'punchy', 'snappy',
    // Emojis
    '🔄', '🔁', '♻️', '✏️',
];

const VARIATION_EXACT_PHRASES: string[] = [
    'redo', 'again', 'another', 'more', 'next', 'retry',
    '1 more', '1more', 'one more', 'onemore',
    // Remix exact matches
    'remix', 'shorter', 'longer', 'funnier',
];

const COPY_KEYWORDS: string[] = [
    'copy', 'clipboard', 'copy script', 'copy text', 'get copy',
    'copy link', 'share', 'get link', 'link', 'send link',
    'copy url', 'copyable', 'text version', 'plain text',
    '📋', '📄', '🔗', '✂️',
];

const COPY_EXACT_PHRASES: string[] = [
    'copy', 'link', 'share', 'get', 'text',
];

const HELP_KEYWORDS: string[] = [
    'help', 'start', 'begin', 'menu', 'options', 'how', 'what',
    'instructions', 'guide', 'tutorial', 'how to', 'how do',
    '?', '❓', '❔',
];

const HELP_EXACT_PHRASES: string[] = [
    'hi', 'hello', 'hey', 'hola', 'yo', 'sup',
    'help', 'start', 'menu', 'hii', 'hiii',
];

const EXTRACT_KEYWORDS: string[] = [
    // Extract/transcript keywords
    'extract', 'original', 'transcript', 'original script', 'copy original',
    'what did they say', 'exact words', 'exact script', 'real script',
    'video script', 'reel script', 'their script', 'their words',
    'get original', 'show original', 'original text', 'source',
    // Verbatim/copy keywords
    'verbatim', 'word-for-word', 'word for word', 'exact copy', 'raw',
    'raw transcript', 'just the words', 'just words', 'spoken words',
    'what they said', 'dialogue', 'subtitles', 'captions',
    // Emojis
    '🎤', '📝', '📜', '🗣️',
];

const EXTRACT_EXACT_PHRASES: string[] = [
    'extract', 'original', 'transcript', 'source',
    // Additional exact matches
    'copy', 'verbatim', 'raw', 'captions', 'subtitles',
];

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

export function normalizeMessage(message: string): string {
    return message
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[.,!?;:]+$/g, '')
        .replace(/^[.,!?;:]+/g, '');
}

export function extractReelUrl(message: string): string | null {
    for (const pattern of REEL_URL_PATTERNS) {
        const match = message.match(pattern);
        if (match) {
            return match[0];
        }
    }
    return null;
}

export function containsReelUrl(message: string): boolean {
    return extractReelUrl(message) !== null;
}

/**
 * Extract user idea from a message that contains a reel URL
 * Removes the URL and common command phrases, returning the core idea
 */
export function extractUserIdeaFromMessageWithUrl(message: string, reelUrl: string): string | null {
    // First, remove the full Instagram URL including any query parameters
    // Instagram URLs often have ?igsh=... or other tracking params
    // Pattern matches the URL and any query string that follows
    const fullUrlPattern = new RegExp(
        escapeRegExp(reelUrl) +
        '(?:\\/)?(?:\\?[a-zA-Z0-9_=&%-]*)?',
        'i'
    );
    let ideaText = message.replace(fullUrlPattern, '').trim();

    // Also remove any standalone URL query parameters that might remain
    // These look like: ?igsh=abc123 or &utm_source=... etc.
    // Remove patterns that look like leftover URL fragments
    const urlFragmentPatterns = [
        /^[?&][a-zA-Z0-9_]+=[\w%-]*/,          // ?param=value or &param=value at start
        /^\/?[?&][a-zA-Z0-9_]+=[\w%-]*/,       // /?igsh=... pattern
        /^\/$/,                                 // Just a trailing slash
    ];

    for (const pattern of urlFragmentPatterns) {
        ideaText = ideaText.replace(pattern, '').trim();
    }

    // Common phrases to remove (case-insensitive)
    // These are generic commands that should NOT be treated as the script topic
    const phrasesToRemove = [
        /^make\s+(this|it|a|an)?\s*/i,
        /^create\s+(this|it|a|an)?\s*/i,
        /^generate\s+(this|it|a|an)?\s*/i,
        /^write\s+(this|it|a|an)?\s*/i,
        /^do\s+(this|it|a|an)?\s*/i,
        /^turn\s+(this|it)\s+into\s+/i,
        /^convert\s+(this|it)\s+to\s+/i,
        /^for\s+me\s*/i,
        /^about\s+/i,
        /^on\s+/i,
        /^video\s+(about|on|for)\s+/i,
        /^reel\s+(about|on|for)\s+/i,
        /^script\s+(about|on|for)\s+/i,
        // NEW: Generic command phrases that often follow a reel URL
        /^start\s+(creating|making|generating)?\s*(script|video|reel)?\s*/i,
        /^go\s*(ahead)?\s*/i,
        /^please\s+(start|create|make|generate|go)\s*/i,
        /^now\s+(start|create|make|generate)?\s*/i,
        /^let'?s?\s+(go|start|create|make)\s*/i,
        /^just\s+(go|start|create|make|do\s+it)?\s*/i,
        /^begin\s*(creating|making)?\s*/i,
        /^run\s*(it)?\s*/i,
        /^execute\s*/i,
        /^here('?s)?\s+(the|a|my)?\s*(reel|video|link)?\s*/i,
        /^this\s+(is|reel|video|one)\s*/i,
        /^check\s+(this|it)\s*(out)?\s*/i,
        // Remove trailing command phrases too
        /\s*start\s+(creating|making|generating)?\s*(script|video|reel)?\s*$/i,
        /\s*go\s*(ahead)?\s*$/i,
        /\s*please\s*$/i,
        /\s*now\s*$/i,
    ];

    // Clean up the idea text
    for (const phrase of phrasesToRemove) {
        ideaText = ideaText.replace(phrase, '');
    }

    // Trim and normalize whitespace
    ideaText = ideaText.trim().replace(/\s+/g, ' ');

    // If the remaining text is too short (<3 chars) or empty, return null
    if (ideaText.length < 3) {
        return null;
    }

    // Additional check: if the text looks like a URL fragment (starts with special chars), reject it
    if (/^[?&/=%]/.test(ideaText)) {
        return null;
    }

    return ideaText;
}

function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesVariationIntent(normalizedMessage: string): boolean {
    if (VARIATION_EXACT_PHRASES.includes(normalizedMessage)) {
        return true;
    }

    return VARIATION_KEYWORDS.some(keyword => {
        const normalizedKeyword = keyword.toLowerCase();
        const regex = new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`, 'i');
        return regex.test(normalizedMessage);
    });
}

export function matchesCopyIntent(normalizedMessage: string): boolean {
    if (COPY_EXACT_PHRASES.includes(normalizedMessage)) {
        return true;
    }

    return COPY_KEYWORDS.some(keyword => {
        const normalizedKeyword = keyword.toLowerCase();
        const regex = new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`, 'i');
        return regex.test(normalizedMessage);
    });
}

export function matchesHelpIntent(normalizedMessage: string): boolean {
    // Check exact phrases first (greetings)
    if (HELP_EXACT_PHRASES.includes(normalizedMessage)) {
        return true;
    }

    // Check keywords
    return HELP_KEYWORDS.some(keyword => {
        const normalizedKeyword = keyword.toLowerCase();
        const regex = new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`, 'i');
        return regex.test(normalizedMessage);
    });
}

export function matchesExtractIntent(normalizedMessage: string): boolean {
    // Check exact phrases first
    if (EXTRACT_EXACT_PHRASES.includes(normalizedMessage)) {
        return true;
    }

    // Check keywords
    return EXTRACT_KEYWORDS.some(keyword => {
        const normalizedKeyword = keyword.toLowerCase();
        const regex = new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`, 'i');
        return regex.test(normalizedMessage);
    });
}

export function getValidStatesForIntent(intent: UserIntent): ChatbotState[] {
    switch (intent) {
        case UserIntent.NEW_REEL:
            return [
                ChatbotState.IDLE,
                ChatbotState.AWAITING_IDEA,
                ChatbotState.AWAITING_FEEDBACK,
                ChatbotState.ERROR,
                ChatbotState.COMPLETED,
            ];

        case UserIntent.SUBMIT_IDEA:
            return [
                ChatbotState.AWAITING_IDEA,
            ];

        case UserIntent.VARIATION:
            return [
                ChatbotState.AWAITING_FEEDBACK,
                ChatbotState.REDO_REQUESTED,
            ];

        case UserIntent.COPY:
            return [
                ChatbotState.AWAITING_FEEDBACK,
                ChatbotState.COMPLETED,
            ];

        case UserIntent.HELP:
            return [
                ChatbotState.IDLE,
                ChatbotState.ERROR,
                ChatbotState.COMPLETED,
            ];

        case UserIntent.EXTRACT_ORIGINAL:
            return [
                ChatbotState.AWAITING_FEEDBACK,
                ChatbotState.COMPLETED,
            ];

        case UserIntent.INVALID:
        default:
            return [];
    }
}

export function isIntentValidForState(intent: UserIntent, state: ChatbotState): boolean {
    const validStates = getValidStatesForIntent(intent);
    return validStates.includes(state);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CLASSIFIER CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class IntentClassifier {

    classify(rawMessage: string, userState: ChatbotState): ClassificationResult {
        if (!rawMessage || rawMessage.trim().length === 0) {
            return {
                intent: UserIntent.INVALID,
                reason: 'Empty message',
                extractedData: {},
                matchedRule: 'EMPTY_MESSAGE',
                validForState: false,
                validInStates: [],
            };
        }

        const normalizedMessage = normalizeMessage(rawMessage);

        // Priority 1: Check for reel URL
        const reelUrl = extractReelUrl(rawMessage);
        if (reelUrl) {
            const intent = UserIntent.NEW_REEL;
            const validForState = isIntentValidForState(intent, userState);

            // ENHANCEMENT: Extract user idea from message (if present)
            const userIdea = extractUserIdeaFromMessageWithUrl(rawMessage, reelUrl);

            return {
                intent,
                reason: userIdea
                    ? 'Message contains Instagram reel URL with user idea'
                    : 'Message contains Instagram reel URL',
                extractedData: {
                    reelUrl,
                    normalizedMessage,
                    userIdea: userIdea || undefined, // Include extracted idea if found
                },
                matchedRule: 'REEL_URL_PATTERN',
                validForState,
                validInStates: validForState ? undefined : getValidStatesForIntent(intent),
            };
        }

        // Priority 2: Check for variation intent
        if (matchesVariationIntent(normalizedMessage)) {
            const intent = UserIntent.VARIATION;
            const validForState = isIntentValidForState(intent, userState);

            return {
                intent,
                reason: 'Message matches variation keyword/phrase',
                extractedData: {
                    normalizedMessage,
                },
                matchedRule: 'VARIATION_KEYWORD',
                validForState,
                validInStates: validForState ? undefined : getValidStatesForIntent(intent),
            };
        }

        // Priority 3: Check for copy intent
        if (matchesCopyIntent(normalizedMessage)) {
            const intent = UserIntent.COPY;
            const validForState = isIntentValidForState(intent, userState);

            return {
                intent,
                reason: 'Message matches copy keyword/phrase',
                extractedData: {
                    normalizedMessage,
                },
                matchedRule: 'COPY_KEYWORD',
                validForState,
                validInStates: validForState ? undefined : getValidStatesForIntent(intent),
            };
        }

        // Priority 4: Check for EXTRACT_ORIGINAL intent (get original transcript)
        if (matchesExtractIntent(normalizedMessage)) {
            const intent = UserIntent.EXTRACT_ORIGINAL;
            const validForState = isIntentValidForState(intent, userState);

            return {
                intent,
                reason: 'Message matches extract/original/transcript keyword',
                extractedData: {
                    normalizedMessage,
                },
                matchedRule: 'EXTRACT_KEYWORD',
                validForState,
                validInStates: validForState ? undefined : getValidStatesForIntent(intent),
            };
        }

        // Priority 5: Check for HELP intent (greetings, help requests)
        // Only check when NOT waiting for idea (otherwise "hi make it funny" is still their idea)
        if (userState !== ChatbotState.AWAITING_IDEA && matchesHelpIntent(normalizedMessage)) {
            const intent = UserIntent.HELP;
            const validForState = isIntentValidForState(intent, userState);

            return {
                intent,
                reason: 'Message matches help/greeting keyword',
                extractedData: {
                    normalizedMessage,
                },
                matchedRule: 'HELP_KEYWORD',
                validForState,
                validInStates: validForState ? undefined : getValidStatesForIntent(intent),
            };
        }

        // Priority 6: Check if user is AWAITING_IDEA and sent plain text (their idea)
        if (userState === ChatbotState.AWAITING_IDEA && normalizedMessage.length >= 2) {
            const intent = UserIntent.SUBMIT_IDEA;
            const validForState = true; // Always valid since we checked state

            return {
                intent,
                reason: 'User is awaiting idea and sent plain text (their idea)',
                extractedData: {
                    normalizedMessage,
                    userIdea: rawMessage.trim(), // Preserve original casing
                },
                matchedRule: 'AWAITING_IDEA_TEXT',
                validForState,
            };
        }

        // Priority 7: No match - INVALID
        return {
            intent: UserIntent.INVALID,
            reason: 'Message does not match any known intent pattern',
            extractedData: {
                normalizedMessage,
            },
            matchedRule: 'NO_MATCH',
            validForState: false,
            validInStates: [],
        };
    }

    classifyIntent(rawMessage: string, userState: ChatbotState): UserIntent {
        return this.classify(rawMessage, userState).intent;
    }

    isValidMessage(rawMessage: string, userState: ChatbotState): boolean {
        const result = this.classify(rawMessage, userState);
        return result.intent !== UserIntent.INVALID && result.validForState;
    }

    getPatterns(): {
        reelUrlPatterns: RegExp[];
        variationKeywords: string[];
        variationExactPhrases: string[];
        copyKeywords: string[];
        copyExactPhrases: string[];
    } {
        return {
            reelUrlPatterns: [...REEL_URL_PATTERNS],
            variationKeywords: [...VARIATION_KEYWORDS],
            variationExactPhrases: [...VARIATION_EXACT_PHRASES],
            copyKeywords: [...COPY_KEYWORDS],
            copyExactPhrases: [...COPY_EXACT_PHRASES],
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

export const intentClassifier = new IntentClassifier();
export { IntentClassifier as IntentClassifierClass };
export default intentClassifier;
