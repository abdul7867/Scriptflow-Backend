import { z } from 'zod';

/**
 * Request Validation Schemas
 * SECURITY: Strict validation prevents injection attacks and abuse
 */

// ============================================
// ManyChat Preprocessor Helper
// Converts unreplaced {{...}} placeholders to undefined
// This allows graceful fallback when custom fields aren't set
// ============================================
const manyChatPreprocess = <T>(schema: z.ZodType<T>) => 
  z.preprocess((val) => {
    // If it's a string that looks like an unreplaced ManyChat variable, treat as undefined
    if (typeof val === 'string' && val.startsWith('{{') && val.endsWith('}}')) {
      return undefined;
    }
    // If it's an empty string, treat as undefined for optional fields
    if (val === '') {
      return undefined;
    }
    return val;
  }, schema);

// Helper to validate Instagram URL properly
const instagramReelUrlSchema = z.string()
  .url("Invalid URL format")
  .refine((url) => {
    try {
      const parsed = new URL(url);
      // SECURITY: Only allow actual Instagram domains (not evil.com/instagram.com)
      const validHosts = ['www.instagram.com', 'instagram.com'];
      return validHosts.includes(parsed.hostname);
    } catch {
      return false;
    }
  }, { message: "URL must be from instagram.com" })
  .refine((url) => url.startsWith('https://'), {
    message: "URL must use HTTPS"
  })
  .refine((url) => url.includes('/reel/') || url.includes('/reels/'), {
    message: "URL must be an Instagram Reel URL"
  });

// Subscriber ID validation (ManyChat IDs are numeric)
// Using z.coerce.string() to accept both string and number inputs
const subscriberIdSchema = z.coerce.string()
  .min(1, "Subscriber ID is required")
  .max(50, "Invalid subscriber ID")
  .refine((id) => /^[0-9]+$/.test(id), {
    message: "Subscriber ID must be numeric"
  });

// User idea with sanitization
const userIdeaSchema = z.string()
  .min(4, "User idea must be longer than 3 characters")
  .max(500, "User idea is too long (max 500 characters)")
  .refine((val) => !/[<>{}\\]/.test(val), {
    message: "User idea contains invalid characters"
  })
  .transform((val) => val.trim());

// ============================================
// NEW: Optional hint parameters
// These are HINTS that work WITH video DNA, not overrides
// Wrapped with manyChatPreprocess to handle unreplaced {{...}} variables
// ============================================

// Tone HINT - subtle preference, video's style is primary
const toneHintSchema = manyChatPreprocess(
  z.enum([
    'professional',
    'funny',
    'provocative',
    'educational',
    'casual'
  ]).optional()
);

// Language HINT - user's preferred language
const languageHintSchema = manyChatPreprocess(
  z.string()
    .max(50)
    .refine((val) => !val || /^[a-zA-Z\s]+$/.test(val), {
      message: "Language must contain only letters"
    })
    .optional()
);

// Generation mode
const modeSchema = manyChatPreprocess(
  z.enum([
    'full',       // Generate full script (HOOK + BODY + CTA)
    'hook_only'   // Generate only the hook for quick testing
  ]).optional().default('full')
);

// ============================================
// Main schema
// ============================================

export const scriptGenerationSchema = z.object({
  subscriber_id: subscriberIdSchema,
  reel_url: instagramReelUrlSchema,
  user_idea: userIdeaSchema,
  
  // Optional hints (preserve video originality)
  tone_hint: toneHintSchema,
  language_hint: languageHintSchema,
  mode: modeSchema
});

export type ScriptGenerationRequest = z.infer<typeof scriptGenerationSchema>;

// ============================================
// Feedback submission schema
// ============================================

export const feedbackSchema = z.object({
  subscriber_id: subscriberIdSchema,
  request_hash: z.string().min(1, "Request hash is required"),
  
  // Overall rating
  overall_rating: z.number().min(1).max(5).optional(),
  
  // Section-level feedback
  section_feedback: z.object({
    hook: z.object({
      rating: z.number().min(1).max(5).optional(),
      regeneration_reason: z.string().max(200).optional()
    }).optional(),
    body: z.object({
      rating: z.number().min(1).max(5).optional(),
      regeneration_reason: z.string().max(200).optional()
    }).optional(),
    cta: z.object({
      rating: z.number().min(1).max(5).optional(),
      regeneration_reason: z.string().max(200).optional()
    }).optional()
  }).optional(),
  
  // Free text feedback
  feedback_text: z.string().max(1000).optional(),
  
  // Video performance (if user provides)
  video_performance: z.object({
    views: z.number().optional(),
    likes: z.number().optional(),
    comments: z.number().optional(),
    shares: z.number().optional()
  }).optional()
});

export type FeedbackRequest = z.infer<typeof feedbackSchema>;

