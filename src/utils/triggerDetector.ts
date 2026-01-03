/**
 * Trigger Detector - Detects user intents from messages
 * 
 * ScriptFlow 2.0 - "4-year-old simple" UX
 * Users don't need to remember commands - natural language works
 */

import { logger } from './logger';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type TriggerType = 'generate' | 'copy' | 'redo' | 'positive_feedback' | 'negative_feedback' | 'idea' | 'unknown';
export type ToneHint = 'professional' | 'funny' | 'provocative' | 'educational' | 'casual';
export type IntensityLevel = 'lite' | 'medium' | 'deep';

export interface TriggerResult {
  /** The detected intent type */
  type: TriggerType;
  
  /** True if user wants instant generation without providing custom idea */
  isInstantFlow: boolean;
  
  /** True if user wants to copy/download video without generating script */
  isCopyFlow: boolean;
  
  /** True if this is a redo/variation request */
  isRedo: boolean;
  
  /** Feedback polarity if type is feedback */
  feedbackPolarity?: 'positive' | 'negative';
  
  /** Detected tone modifier from message */
  detectedTone?: ToneHint;
  
  /** Detected intensity level (--lite, --deep) */
  intensity: IntensityLevel;
  
  /** True if user wants only the hook section */
  isHookOnly: boolean;
  
  /** Original message with trigger words cleaned out */
  cleanedMessage: string;
  
  /** Confidence score 0-1 */
  confidence: number;
  
  /** Which pattern matched (for debugging) */
  matchedPattern?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRIGGER PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Instant generation triggers - user wants AI to generate without custom idea
 * These trigger the "instant flow" where we use smart defaults
 */
const INSTANT_TRIGGERS: RegExp[] = [
  /^generate$/i,
  /^go$/i,
  /^make(\s+it)?$/i,
  /^remix(\s+it)?$/i,
  /^remix(\s+this)?$/i,
  /^steal(\s+this)?$/i,
  /^steal(\s+it)?$/i,
  /^create$/i,
  /^create(\s+script)?$/i,
  /^do(\s+it)?$/i,
  /^yes(\s+generate)?$/i,
  /^ok(\s+generate)?$/i,
  /^okay(\s+generate)?$/i,
  /^sure$/i,
  /^please$/i,
  /^✨$/,
  /^🎬$/,
  /^🚀$/,
  /^⚡$/,
];

/**
 * Copy triggers - user wants to download/analyze video without generating script
 * This allows them to later generate multiple scripts from the same video
 */
const COPY_TRIGGERS: RegExp[] = [
  /^copy(\s+this)?$/i,
  /^copy(\s+it)?$/i,
  /^copy(\s+video)?$/i,
  /^save(\s+this)?$/i,
  /^save(\s+it)?$/i,
  /^download(\s+this)?$/i,
  /^download(\s+it)?$/i,
  /^analyze(\s+this)?$/i,
  /^analyze(\s+it)?$/i,
  /^�$/,
  /^�$/,
];

/**
 * Redo/variation triggers - user wants another version
 * System remembers last request and generates fresh variation
 */
const REDO_TRIGGERS: RegExp[] = [
  /^another(\s+one)?$/i,
  /^again$/i,
  /^more$/i,
  /^different(\s+one)?$/i,
  /^redo$/i,
  /^retry$/i,
  /^new(\s+one)?$/i,
  /^try(\s+again)?$/i,
  /^one(\s+more)?$/i,
  /^next$/i,
  /^🔄$/,
  /^🔁$/,
  /^♻️$/,
];

/**
 * Positive feedback - user likes the result
 * Log for ML training, no regeneration needed
 */
const POSITIVE_FEEDBACK: RegExp[] = [
  /^yes$/i,
  /^good$/i,
  /^great$/i,
  /^perfect$/i,
  /^love(\s+it)?$/i,
  /^amazing$/i,
  /^awesome$/i,
  /^nice$/i,
  /^cool$/i,
  /^thanks?$/i,
  /^thank(\s+you)?$/i,
  /^exactly$/i,
  /^fire$/i,
  /^🔥$/,
  /^👍$/,
  /^❤️$/,
  /^💯$/,
  /^🙌$/,
  /^👏$/,
  /^✅$/,
];

/**
 * Negative feedback - user doesn't like the result
 * Log for ML training, may trigger regeneration with adjustments
 */
const NEGATIVE_FEEDBACK: RegExp[] = [
  /^no$/i,
  /^bad$/i,
  /^wrong$/i,
  /^meh$/i,
  /^nope$/i,
  /^nah$/i,
  /^not(\s+good)?$/i,
  /^terrible$/i,
  /^horrible$/i,
  /^hate(\s+it)?$/i,
  /^dislike$/i,
  /^👎$/,
  /^😕$/,
  /^😞$/,
  /^❌$/,
];

/**
 * Hook-only triggers - user wants just the opening hook
 * Faster generation, lower cost
 */
const HOOK_ONLY_PATTERNS: RegExp[] = [
  /\bhook\s*only\b/i,
  /\bjust\s*(the\s*)?hook\b/i,
  /\bonly\s*(the\s*)?hook\b/i,
  /\bgive\s*me\s*(the\s*)?hook\b/i,
  /\bhook\s*please\b/i,
  /🎣/,
];

/**
 * Tone modifiers - user indicates preferred style
 */
const TONE_PATTERNS: Record<ToneHint, RegExp[]> = {
  funny: [
    /\bfunny\b/i,
    /\bhumor(ous)?\b/i,
    /\bcomedy\b/i,
    /\blaugh\b/i,
    /\bjoke\b/i,
    /\bhilarious\b/i,
    /😂/,
    /🤣/,
  ],
  professional: [
    /\bprofessional\b/i,
    /\bbusiness\b/i,
    /\bcorporate\b/i,
    /\bformal\b/i,
    /\bserious\b/i,
    /💼/,
  ],
  provocative: [
    /\bprovocative\b/i,
    /\bcontroversial\b/i,
    /\bedgy\b/i,
    /\bbold\b/i,
    /\bspicy\b/i,
    /🌶️/,
    /🔥/,
  ],
  educational: [
    /\beducational\b/i,
    /\bteach(ing)?\b/i,
    /\blearn(ing)?\b/i,
    /\binformative\b/i,
    /\bhow\s*to\b/i,
    /📚/,
    /🎓/,
  ],
  casual: [
    /\bcasual\b/i,
    /\brelaxed\b/i,
    /\bchill\b/i,
    /\bfriendly\b/i,
    /\bconversational\b/i,
    /😊/,
  ],
};

/**
 * Intensity modifiers - control how much transformation is applied
 */
const INTENSITY_PATTERNS: Record<IntensityLevel, RegExp[]> = {
  lite: [
    /--lite\b/i,
    /--light\b/i,
    /\bsimilar\b/i,
    /\bclose\s*to\b/i,
    /\blike\s*this\b/i,
  ],
  medium: [], // Default, no explicit triggers
  deep: [
    /--deep\b/i,
    /--full\b/i,
    /\bcompletely\s*different\b/i,
    /\btotally\s*new\b/i,
    /\btransform\b/i,
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if message matches any pattern in array
 */
function matchesAny(message: string, patterns: RegExp[]): { matches: boolean; pattern?: string } {
  for (const pattern of patterns) {
    if (pattern.test(message)) {
      return { matches: true, pattern: pattern.toString() };
    }
  }
  return { matches: false };
}

/**
 * Detect tone from message
 */
function detectTone(message: string): ToneHint | undefined {
  for (const [tone, patterns] of Object.entries(TONE_PATTERNS)) {
    const { matches } = matchesAny(message, patterns);
    if (matches) {
      return tone as ToneHint;
    }
  }
  return undefined;
}

/**
 * Detect intensity level from message
 */
function detectIntensity(message: string): IntensityLevel {
  for (const [intensity, patterns] of Object.entries(INTENSITY_PATTERNS)) {
    if (patterns.length === 0) continue;
    const { matches } = matchesAny(message, patterns);
    if (matches) {
      return intensity as IntensityLevel;
    }
  }
  return 'medium'; // Default
}

/**
 * Check if hook-only mode is requested
 */
function isHookOnlyRequest(message: string): boolean {
  return matchesAny(message, HOOK_ONLY_PATTERNS).matches;
}

/**
 * Clean trigger words from message to extract the actual idea
 */
function cleanMessage(message: string): string {
  let cleaned = message;
  
  // Remove instant triggers
  INSTANT_TRIGGERS.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Remove copy triggers
  COPY_TRIGGERS.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Remove redo triggers
  REDO_TRIGGERS.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Remove feedback triggers
  [...POSITIVE_FEEDBACK, ...NEGATIVE_FEEDBACK].forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Remove hook-only patterns
  HOOK_ONLY_PATTERNS.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Remove tone patterns
  Object.values(TONE_PATTERNS).flat().forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Remove intensity patterns
  Object.values(INTENSITY_PATTERNS).flat().forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Clean up whitespace
  return cleaned.trim().replace(/\s+/g, ' ');
}

/**
 * Check if message contains Instagram reel URL
 */
export function containsReelUrl(message: string): boolean {
  const reelUrlPattern = /https?:\/\/(www\.)?instagram\.com\/(reel|reels)\/[\w-]+/i;
  return reelUrlPattern.test(message);
}

/**
 * Extract Instagram reel URL from message
 */
export function extractReelUrl(message: string): string | null {
  const reelUrlPattern = /https?:\/\/(www\.)?instagram\.com\/(reel|reels)\/[\w-]+/i;
  const match = message.match(reelUrlPattern);
  return match ? match[0] : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN DETECTOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect user intent from message
 * 
 * @param message - Raw user message
 * @returns TriggerResult with detected intent and metadata
 * 
 * @example
 * detectTrigger("generate") 
 * // → { type: 'generate', isInstantFlow: true, ... }
 * 
 * @example
 * detectTrigger("another one")
 * // → { type: 'redo', isRedo: true, ... }
 * 
 * @example
 * detectTrigger("make a funny script about coffee")
 * // → { type: 'idea', detectedTone: 'funny', cleanedMessage: 'script about coffee', ... }
 */
export function detectTrigger(message: string): TriggerResult {
  const trimmedMessage = message.trim();
  
  // Default result
  const result: TriggerResult = {
    type: 'unknown',
    isInstantFlow: false,
    isCopyFlow: false,
    isRedo: false,
    intensity: 'medium',
    isHookOnly: false,
    cleanedMessage: trimmedMessage,
    confidence: 0,
  };
  
  // Empty message
  if (!trimmedMessage) {
    return result;
  }
  
  // Check for hook-only (can combine with other intents)
  result.isHookOnly = isHookOnlyRequest(trimmedMessage);
  
  // Check for tone modifier (can combine with other intents)
  result.detectedTone = detectTone(trimmedMessage);
  
  // Check for intensity (can combine with other intents)
  result.intensity = detectIntensity(trimmedMessage);
  
  // Clean the message
  result.cleanedMessage = cleanMessage(trimmedMessage);
  
  // Priority 1: Check for copy triggers (highest priority for download-only)
  const copyMatch = matchesAny(trimmedMessage, COPY_TRIGGERS);
  if (copyMatch.matches) {
    result.type = 'copy';
    result.isCopyFlow = true;
    result.confidence = 0.95;
    result.matchedPattern = copyMatch.pattern;
    
    logger.debug('Trigger detected: copy/download', { 
      message: trimmedMessage, 
      pattern: copyMatch.pattern 
    });
    
    return result;
  }
  
  // Priority 2: Check for instant generation triggers
  const instantMatch = matchesAny(trimmedMessage, INSTANT_TRIGGERS);
  if (instantMatch.matches) {
    result.type = 'generate';
    result.isInstantFlow = true;
    result.confidence = 0.95;
    result.matchedPattern = instantMatch.pattern;
    
    logger.debug('Trigger detected: instant generate', { 
      message: trimmedMessage, 
      pattern: instantMatch.pattern 
    });
    
    return result;
  }
  
  // Priority 3: Check for redo triggers
  const redoMatch = matchesAny(trimmedMessage, REDO_TRIGGERS);
  if (redoMatch.matches) {
    result.type = 'redo';
    result.isRedo = true;
    result.confidence = 0.95;
    result.matchedPattern = redoMatch.pattern;
    
    logger.debug('Trigger detected: redo', { 
      message: trimmedMessage, 
      pattern: redoMatch.pattern 
    });
    
    return result;
  }
  
  // Priority 4: Check for positive feedback
  const positiveMatch = matchesAny(trimmedMessage, POSITIVE_FEEDBACK);
  if (positiveMatch.matches) {
    result.type = 'positive_feedback';
    result.feedbackPolarity = 'positive';
    result.confidence = 0.9;
    result.matchedPattern = positiveMatch.pattern;
    
    logger.debug('Trigger detected: positive feedback', { 
      message: trimmedMessage, 
      pattern: positiveMatch.pattern 
    });
    
    return result;
  }
  
  // Priority 5: Check for negative feedback
  const negativeMatch = matchesAny(trimmedMessage, NEGATIVE_FEEDBACK);
  if (negativeMatch.matches) {
    result.type = 'negative_feedback';
    result.feedbackPolarity = 'negative';
    result.confidence = 0.9;
    result.matchedPattern = negativeMatch.pattern;
    
    logger.debug('Trigger detected: negative feedback', { 
      message: trimmedMessage, 
      pattern: negativeMatch.pattern 
    });
    
    return result;
  }
  
  // Priority 6: If message has substantial content after cleaning, it's an idea
  if (result.cleanedMessage.length > 3) {
    result.type = 'idea';
    result.confidence = 0.8;
    
    logger.debug('Trigger detected: user idea', { 
      originalMessage: trimmedMessage, 
      cleanedMessage: result.cleanedMessage 
    });
    
    return result;
  }
  
  // Unknown intent
  result.confidence = 0.3;
  logger.debug('Trigger detection: unknown intent', { message: trimmedMessage });
  
  return result;
}

/**
 * Detect if message is a combined reel URL + trigger
 * e.g., "https://instagram.com/reel/abc123 generate"
 */
export function detectCombinedMessage(message: string): {
  hasReelUrl: boolean;
  reelUrl: string | null;
  remainingMessage: string;
  trigger: TriggerResult;
} {
  const reelUrl = extractReelUrl(message);
  
  if (reelUrl) {
    // Remove the URL from message to analyze the rest
    const remainingMessage = message.replace(reelUrl, '').trim();
    const trigger = detectTrigger(remainingMessage);
    
    return {
      hasReelUrl: true,
      reelUrl,
      remainingMessage,
      trigger,
    };
  }
  
  return {
    hasReelUrl: false,
    reelUrl: null,
    remainingMessage: message,
    trigger: detectTrigger(message),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  detectTrigger,
  detectCombinedMessage,
  containsReelUrl,
  extractReelUrl,
};
