/**
 * Default Ideas Generator - Smart defaults for instant flow
 * 
 * When user just says "generate" without a custom idea,
 * we provide contextually appropriate defaults based on video analysis
 * 
 * Philosophy: "Steal Like an Artist" - capture the essence, transform it
 */

import { logger } from './logger';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface VideoContext {
  /** Detected hook type from video analysis */
  hookType?: string;
  
  /** Detected tone/energy of the video */
  tone?: string;
  
  /** Detected content niche/category */
  niche?: string;
  
  /** Video duration in seconds */
  durationSeconds?: number;
  
  /** Number of scenes detected */
  sceneCount?: number;
  
  /** Primary language detected */
  language?: string;
}

export interface DefaultIdeaResult {
  /** The generated default idea text */
  idea: string;
  
  /** Whether this is a default (vs user-provided) */
  isDefault: true;
  
  /** Which template category was used */
  category: string;
  
  /** Confidence in the match (0-1) */
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// IDEA TEMPLATES BY CATEGORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generic templates - used when we can't determine specific context
 * Designed to work with any video style
 */
const GENERIC_TEMPLATES = [
  "Create a viral script capturing this exact energy and style",
  "Remix this into something fresh but equally engaging",
  "Steal the structure and make it my own unique version",
  "Create a script with the same hook power and flow",
  "Transform this into my style while keeping what works",
];

/**
 * Educational content templates
 */
const EDUCATIONAL_TEMPLATES = [
  "Create an educational script teaching something valuable in this style",
  "Make a how-to script with the same teaching approach",
  "Transform this into a lesson that delivers real value",
  "Create a knowledge-sharing script with this energy",
  "Build an informative script using this format",
];

/**
 * Entertainment/Funny content templates
 */
const ENTERTAINMENT_TEMPLATES = [
  "Create something equally entertaining and shareable",
  "Make a funny script with the same comedic timing",
  "Transform this humor style into fresh content",
  "Create engaging entertainment with this vibe",
  "Build a script that makes people laugh and share",
];

/**
 * Promotional/Business content templates
 */
const PROMOTIONAL_TEMPLATES = [
  "Create a persuasive script with this selling approach",
  "Transform this into compelling promotional content",
  "Make a business script with the same hook power",
  "Create a conversion-focused script in this style",
  "Build promotional content that doesn't feel salesy",
];

/**
 * Storytelling content templates
 */
const STORYTELLING_TEMPLATES = [
  "Create a story script with the same narrative arc",
  "Transform this storytelling approach into my story",
  "Make a personal narrative with this emotional flow",
  "Create engaging story content with this structure",
  "Build a relatable story using this format",
];

/**
 * Motivational/Inspirational content templates
 */
const MOTIVATIONAL_TEMPLATES = [
  "Create an inspiring script with this uplifting energy",
  "Transform this into motivational content that moves people",
  "Make an empowering script with the same impact",
  "Create content that inspires action like this",
  "Build a motivational message with this delivery style",
];

/**
 * Hook-specific templates based on detected hook type
 */
const HOOK_TYPE_TEMPLATES: Record<string, string[]> = {
  'question': [
    "Create a script with an equally powerful question hook",
    "Build content that opens with curiosity like this",
  ],
  'statement': [
    "Create a bold opening statement script like this",
    "Make a script with the same authoritative hook",
  ],
  'action': [
    "Create an action-packed opening like this",
    "Build a dynamic script with this energy",
  ],
  'visual-shock': [
    "Create visually striking content with this impact",
    "Make a pattern-interrupt script like this",
  ],
  'text-only': [
    "Create a text-focused script with this style",
    "Build content relying on powerful text overlays",
  ],
  'negative visual': [
    "Create a contrarian hook script like this",
    "Make a myth-busting script with this approach",
  ],
  'stop scrolling': [
    "Create a scroll-stopping script with this power",
    "Build an attention-grabbing hook like this",
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// NICHE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Common content niches and their keyword indicators
 */
const NICHE_KEYWORDS: Record<string, string[]> = {
  fitness: ['workout', 'gym', 'exercise', 'muscle', 'weight', 'health', 'fit', 'training'],
  tech: ['app', 'software', 'code', 'tech', 'ai', 'digital', 'computer', 'programming'],
  finance: ['money', 'invest', 'crypto', 'stock', 'wealth', 'income', 'budget', 'savings'],
  beauty: ['makeup', 'skincare', 'beauty', 'hair', 'cosmetic', 'glow', 'routine'],
  food: ['recipe', 'cook', 'food', 'meal', 'eat', 'kitchen', 'restaurant', 'chef'],
  travel: ['travel', 'trip', 'destination', 'vacation', 'explore', 'adventure', 'tourist'],
  lifestyle: ['morning', 'routine', 'life', 'day', 'productivity', 'habit', 'self'],
  business: ['business', 'entrepreneur', 'startup', 'marketing', 'sales', 'brand', 'company'],
  relationship: ['relationship', 'dating', 'love', 'couple', 'marriage', 'partner'],
  parenting: ['parent', 'kid', 'child', 'baby', 'mom', 'dad', 'family'],
};

/**
 * Niche-specific idea templates
 */
const NICHE_TEMPLATES: Record<string, string[]> = {
  fitness: [
    "Create a fitness script with this motivating energy",
    "Transform this into workout content that inspires action",
  ],
  tech: [
    "Create a tech script that explains things this simply",
    "Make tech content with the same accessible approach",
  ],
  finance: [
    "Create a money script with this practical approach",
    "Transform this into actionable financial content",
  ],
  beauty: [
    "Create a beauty script with this aesthetic style",
    "Make beauty content with the same tutorial flow",
  ],
  food: [
    "Create a food script with this appetizing energy",
    "Transform this into delicious content people crave",
  ],
  travel: [
    "Create a travel script with this wanderlust energy",
    "Make travel content that inspires exploration",
  ],
  lifestyle: [
    "Create a lifestyle script with this relatable approach",
    "Transform this into aspirational daily content",
  ],
  business: [
    "Create a business script with this professional authority",
    "Make business content that builds credibility like this",
  ],
  relationship: [
    "Create relationship content with this authentic voice",
    "Transform this into relatable relationship advice",
  ],
  parenting: [
    "Create parenting content with this understanding tone",
    "Make family content that resonates like this",
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect niche from transcript or visual cues
 */
function detectNiche(context: VideoContext, transcript?: string): string | undefined {
  if (context.niche) {
    return context.niche;
  }
  
  if (!transcript) {
    return undefined;
  }
  
  const lowerTranscript = transcript.toLowerCase();
  
  for (const [niche, keywords] of Object.entries(NICHE_KEYWORDS)) {
    const matchCount = keywords.filter(kw => lowerTranscript.includes(kw)).length;
    if (matchCount >= 2) {
      return niche;
    }
  }
  
  return undefined;
}

/**
 * Detect content type from tone and context
 */
function detectContentType(context: VideoContext): string {
  const tone = context.tone?.toLowerCase() || '';
  
  if (tone.includes('educational') || tone.includes('informative')) {
    return 'educational';
  }
  if (tone.includes('funny') || tone.includes('humor') || tone.includes('comedy')) {
    return 'entertainment';
  }
  if (tone.includes('promotional') || tone.includes('sales')) {
    return 'promotional';
  }
  if (tone.includes('story') || tone.includes('narrative')) {
    return 'storytelling';
  }
  if (tone.includes('motivational') || tone.includes('inspiring')) {
    return 'motivational';
  }
  
  return 'generic';
}

/**
 * Pick a random item from array with optional seed for consistency
 */
function pickRandom<T>(items: T[], seed?: number): T {
  const index = seed !== undefined 
    ? Math.abs(seed) % items.length 
    : Math.floor(Math.random() * items.length);
  return items[index];
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a smart default idea based on video context
 * 
 * Priority order:
 * 1. Niche-specific template (if niche detected)
 * 2. Hook-type specific template (if hook type known)
 * 3. Content-type template (based on tone)
 * 4. Generic template (fallback)
 * 
 * @param context - Video analysis context
 * @param transcript - Optional transcript for better niche detection
 * @param variationIndex - For picking different templates on redos
 * @returns DefaultIdeaResult with the generated idea
 * 
 * @example
 * getDefaultIdea({ tone: 'Educational', hookType: 'question' })
 * // → { idea: "Create an educational script teaching something valuable...", ... }
 */
export function getDefaultIdea(
  context: VideoContext = {},
  transcript?: string,
  variationIndex: number = 0
): DefaultIdeaResult {
  
  // Try to detect niche
  const niche = detectNiche(context, transcript);
  
  // Priority 1: Niche-specific template
  if (niche && NICHE_TEMPLATES[niche]) {
    const templates = NICHE_TEMPLATES[niche];
    return {
      idea: pickRandom(templates, variationIndex),
      isDefault: true,
      category: `niche:${niche}`,
      confidence: 0.85,
    };
  }
  
  // Priority 2: Hook-type specific template
  const hookType = context.hookType?.toLowerCase();
  if (hookType) {
    for (const [type, templates] of Object.entries(HOOK_TYPE_TEMPLATES)) {
      if (hookType.includes(type)) {
        return {
          idea: pickRandom(templates, variationIndex),
          isDefault: true,
          category: `hookType:${type}`,
          confidence: 0.8,
        };
      }
    }
  }
  
  // Priority 3: Content-type template
  const contentType = detectContentType(context);
  
  let templates: string[];
  switch (contentType) {
    case 'educational':
      templates = EDUCATIONAL_TEMPLATES;
      break;
    case 'entertainment':
      templates = ENTERTAINMENT_TEMPLATES;
      break;
    case 'promotional':
      templates = PROMOTIONAL_TEMPLATES;
      break;
    case 'storytelling':
      templates = STORYTELLING_TEMPLATES;
      break;
    case 'motivational':
      templates = MOTIVATIONAL_TEMPLATES;
      break;
    default:
      templates = GENERIC_TEMPLATES;
  }
  
  const idea = pickRandom(templates, variationIndex);
  
  logger.debug('Generated default idea', {
    context,
    niche,
    contentType,
    variationIndex,
    selectedIdea: idea,
  });
  
  return {
    idea,
    isDefault: true,
    category: contentType === 'generic' ? 'generic' : `contentType:${contentType}`,
    confidence: contentType === 'generic' ? 0.6 : 0.75,
  };
}

/**
 * Get a variation of an existing idea for redo requests
 * Modifies the approach while keeping similar intent
 */
export function getIdeaVariation(originalIdea: string, variationIndex: number): string {
  // Variation prefixes that transform the approach
  const variationPrefixes = [
    "Take a different angle:",
    "Fresh perspective:",
    "Try this approach:",
    "Alternative take:",
    "New direction:",
  ];
  
  const prefix = variationPrefixes[variationIndex % variationPrefixes.length];
  
  // If it's already a default idea, just get a new default
  if (originalIdea.toLowerCase().includes('capture this') || 
      originalIdea.toLowerCase().includes('remix this') ||
      originalIdea.toLowerCase().includes('transform this')) {
    return pickRandom(GENERIC_TEMPLATES, variationIndex);
  }
  
  // For user ideas, add variation guidance
  return `${prefix} ${originalIdea}`;
}

/**
 * Check if an idea is likely a default (vs user-provided)
 */
export function isDefaultIdea(idea: string): boolean {
  const defaultPatterns = [
    /capture this/i,
    /remix this/i,
    /steal the/i,
    /transform this/i,
    /in this style/i,
    /with this energy/i,
    /like this/i,
    /this approach/i,
  ];
  
  return defaultPatterns.some(pattern => pattern.test(idea));
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  getDefaultIdea,
  getIdeaVariation,
  isDefaultIdea,
};
