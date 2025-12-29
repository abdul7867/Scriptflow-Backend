import mongoose, { Schema, Document } from 'mongoose';

/**
 * Enhanced Dataset Entry Interface
 * Comprehensive schema for ML model training
 * 
 * Captures:
 * - INPUT: What we received (video analysis, user preferences)
 * - OUTPUT: What we generated (structured script sections)
 * - FEEDBACK: User signals (ratings, regenerations, engagement)
 * - GENERATION: Model metadata for reproducibility
 * - TRAINING: Quality scores and inclusion flags
 */

// ============================================
// Type Definitions
// ============================================

export type ToneHint = 'professional' | 'funny' | 'provocative' | 'educational' | 'casual';
export type GenerationMode = 'full' | 'hook_only';

export interface ISectionFeedback {
  rating?: number;           // 1-5 stars
  wasRegenerated: boolean;
  regenerationReason?: string;
}

export interface IVideoPerformance {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  reportedAt?: Date;
}

export interface IDatasetEntry extends Document {
  // ═══════════════════════════════════════════════════════════
  // INPUT FEATURES (What we received)
  // ═══════════════════════════════════════════════════════════
  input: {
    // Original request
    videoUrl: string;
    userIdea: string;
    requestHash: string;           // For linking feedback
    
    // User preferences (HINTS, not overrides)
    toneHint?: ToneHint;
    languageHint?: string;
    mode: GenerationMode;
    
    // Extracted from video
    transcript?: string;
    transcriptLanguage?: string;   // Detected language
    transcriptWordCount?: number;
    
    // Visual analysis
    visualCues: string[];
    hookType?: string;
    detectedTone?: string;         // What AI detected
    sceneDescriptions: string[];
    
    // Video metadata
    videoDurationSeconds?: number;
    frameCount?: number;
  };

  // ═══════════════════════════════════════════════════════════
  // OUTPUT FEATURES (What we generated)
  // ═══════════════════════════════════════════════════════════
  output: {
    generatedScript: string;
    
    // Structured sections (for section-level learning)
    scriptSections: {
      hook?: string;
      body?: string;
      cta?: string;
    };
    
    // Parsed elements
    visualDirections: string[];    // All 🎬 VISUAL lines
    dialogueLines: string[];       // All 💬 SAY lines
    
    // Script metrics
    scriptLengthChars: number;
    estimatedSpokenDuration?: number;
    hookLengthChars?: number;
    bodyLengthChars?: number;
    ctaLengthChars?: number;
  };

  // ═══════════════════════════════════════════════════════════
  // USER FEEDBACK (Learning signals)
  // ═══════════════════════════════════════════════════════════
  feedback: {
    // Overall quality
    overallRating?: number;        // 1-5 stars
    wasAccepted: boolean;          // Used without changes?
    
    // Section-level feedback
    sectionFeedback: {
      hook?: ISectionFeedback;
      body?: ISectionFeedback;
      cta?: ISectionFeedback;
    };
    
    // Free text
    feedbackText?: string;
    
    // Engagement tracking
    videoPerformance?: IVideoPerformance;
  };

  // ═══════════════════════════════════════════════════════════
  // GENERATION METADATA (For reproducibility)
  // ═══════════════════════════════════════════════════════════
  generation: {
    analysisModel: string;         // e.g., "gemini-2.5-flash"
    scriptModel: string;
    
    analysisTimeMs: number;
    generationTimeMs: number;
    totalTimeMs: number;
    
    analysisAttempts: number;
    generationAttempts: number;
    
    promptVersion: string;         // For A/B testing prompts
  };

  // ═══════════════════════════════════════════════════════════
  // ML TRAINING FLAGS
  // ═══════════════════════════════════════════════════════════
  training: {
    isValidated: boolean;          // Human reviewed
    qualityScore: number;          // 0-100 computed score
    
    includedInTraining: boolean;
    trainingBatch?: string;
    
    datasetVersion: string;
    schemaVersion: string;
  };

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Schema Definition
// ============================================

const SectionFeedbackSchema = new Schema({
  rating: { type: Number, min: 1, max: 5 },
  wasRegenerated: { type: Boolean, default: false },
  regenerationReason: String
}, { _id: false });

const VideoPerformanceSchema = new Schema({
  views: Number,
  likes: Number,
  comments: Number,
  shares: Number,
  reportedAt: Date
}, { _id: false });

const DatasetEntrySchema = new Schema<IDatasetEntry>({
  // INPUT
  input: {
    videoUrl: { type: String, required: true },
    userIdea: { type: String, required: true },
    requestHash: { type: String, required: true, index: true },
    
    toneHint: { type: String, enum: ['professional', 'funny', 'provocative', 'educational', 'casual'] },
    languageHint: String,
    mode: { type: String, enum: ['full', 'hook_only'], default: 'full' },
    
    transcript: String,
    transcriptLanguage: String,
    transcriptWordCount: Number,
    
    visualCues: [String],
    hookType: String,
    detectedTone: String,
    sceneDescriptions: [String],
    
    videoDurationSeconds: Number,
    frameCount: Number
  },

  // OUTPUT
  output: {
    generatedScript: { type: String, required: true },
    scriptSections: {
      hook: String,
      body: String,
      cta: String
    },
    visualDirections: [String],
    dialogueLines: [String],
    
    scriptLengthChars: { type: Number, required: true },
    estimatedSpokenDuration: Number,
    hookLengthChars: Number,
    bodyLengthChars: Number,
    ctaLengthChars: Number
  },

  // FEEDBACK
  feedback: {
    overallRating: { type: Number, min: 1, max: 5 },
    wasAccepted: { type: Boolean, default: true },
    sectionFeedback: {
      hook: SectionFeedbackSchema,
      body: SectionFeedbackSchema,
      cta: SectionFeedbackSchema
    },
    feedbackText: String,
    videoPerformance: VideoPerformanceSchema
  },

  // GENERATION
  generation: {
    analysisModel: { type: String, default: 'gemini-2.5-flash' },
    scriptModel: { type: String, default: 'gemini-2.5-flash' },
    analysisTimeMs: Number,
    generationTimeMs: Number,
    totalTimeMs: Number,
    analysisAttempts: { type: Number, default: 1 },
    generationAttempts: { type: Number, default: 1 },
    promptVersion: { type: String, default: 'steal-artist-v2.0' }
  },

  // TRAINING
  training: {
    isValidated: { type: Boolean, default: false },
    qualityScore: { type: Number, default: 50, min: 0, max: 100 },
    includedInTraining: { type: Boolean, default: false },
    trainingBatch: String,
    datasetVersion: { type: String, default: '2.0.0' },
    schemaVersion: { type: String, default: '2.0.0' }
  }
}, {
  timestamps: true
});

// ============================================
// Indexes for efficient queries
// ============================================

// For dataset filtering
DatasetEntrySchema.index({ 'training.isValidated': 1, 'training.includedInTraining': 1 });
DatasetEntrySchema.index({ 'training.qualityScore': -1 });
DatasetEntrySchema.index({ 'feedback.overallRating': -1 });

// For time-based queries
DatasetEntrySchema.index({ createdAt: -1 });

// For model version analysis
DatasetEntrySchema.index({ 'generation.analysisModel': 1, 'generation.scriptModel': 1 });

// ============================================
// Quality Score Computation
// ============================================

/**
 * Compute quality score for training data prioritization
 * Higher score = more valuable for training
 */
export function computeQualityScore(entry: IDatasetEntry): number {
  let score = 50; // Base score
  
  // User signals (most valuable)
  if (entry.feedback.overallRating) {
    score += (entry.feedback.overallRating - 3) * 15; // -30 to +30
  }
  if (entry.feedback.wasAccepted) score += 20;
  
  // Section-level signals
  const sections = entry.feedback.sectionFeedback;
  if (sections) {
    if (sections.hook && !sections.hook.wasRegenerated) score += 5;
    if (sections.body && !sections.body.wasRegenerated) score += 5;
    if (sections.cta && !sections.cta.wasRegenerated) score += 5;
  }
  
  // Engagement signals (if available)
  const perf = entry.feedback.videoPerformance;
  if (perf?.views && perf.views > 10000) score += 10;
  if (perf?.likes && perf?.views && (perf.likes / perf.views) > 0.1) score += 10;
  
  // Completeness signals
  if (entry.input.transcript) score += 5;
  if (entry.input.visualCues?.length > 3) score += 5;
  
  return Math.min(100, Math.max(0, score));
}

// ============================================
// Helper functions
// ============================================

/**
 * Parse script into structured sections
 */
export function parseScriptSections(scriptText: string): { hook?: string; body?: string; cta?: string } {
  const sections: { hook?: string; body?: string; cta?: string } = {};
  
  const parts = scriptText.split(/\[(HOOK|BODY|CTA)\]/i);
  
  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i]?.toUpperCase();
    const content = parts[i + 1]?.trim() || '';
    
    if (header === 'HOOK') sections.hook = content;
    else if (header === 'BODY') sections.body = content;
    else if (header === 'CTA') sections.cta = content;
  }
  
  return sections;
}

/**
 * Extract all VISUAL lines from script
 */
export function extractVisualLines(scriptText: string): string[] {
  const lines = scriptText.split('\n');
  return lines
    .filter(line => line.includes('🎬') || line.toLowerCase().includes('visual:'))
    .map(line => line.replace(/^🎬\s*VISUAL:\s*/i, '').replace(/^VISUAL:\s*/i, '').trim());
}

/**
 * Extract all SAY lines from script
 */
export function extractDialogueLines(scriptText: string): string[] {
  const lines = scriptText.split('\n');
  return lines
    .filter(line => line.includes('💬') || line.toLowerCase().includes('say:'))
    .map(line => line.replace(/^💬\s*SAY:\s*/i, '').replace(/^SAY:\s*/i, '').trim());
}

/**
 * Estimate spoken duration (words / 150 WPM)
 */
export function estimateSpokenDuration(scriptText: string): number {
  const dialogueLines = extractDialogueLines(scriptText);
  const wordCount = dialogueLines.join(' ').split(/\s+/).length;
  return Math.round((wordCount / 150) * 60); // seconds
}

/**
 * Count words in text
 */
export function countWords(text?: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

export const DatasetEntry = mongoose.model<IDatasetEntry>('DatasetEntry', DatasetEntrySchema);
