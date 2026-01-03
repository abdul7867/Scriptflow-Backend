/**
 * DatasetV2 - Enhanced ML Training Schema
 * 
 * ScriptFlow 2.0 - Comprehensive data collection for model training
 * 
 * Key improvements over V1:
 * - User context (tier, history, preferences)
 * - Variation tracking for RLHF
 * - Content classification for niche optimization
 * - Experiment tracking for A/B testing
 * - Alternative scripts for preference learning
 * - Quality metrics breakdown
 * - Failure tracking for debugging
 * - Implicit feedback signals
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export type ToneHint = 'professional' | 'funny' | 'provocative' | 'educational' | 'casual';
export type GenerationMode = 'full' | 'hook_only';
export type TriggerType = 'guided' | 'instant' | 'redo';
export type ContentType = 'educational' | 'promotional' | 'entertainment' | 'storytelling' | 'motivational' | 'other';
export type UserTier = 'free' | 'beta' | 'premium' | 'enterprise';

// ═══════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

export interface IDatasetEntryV2 extends Document {
  // ─────────────────────────────────────────────────────────────────────────
  // SCHEMA METADATA
  // ─────────────────────────────────────────────────────────────────────────
  schemaVersion: string;
  
  // ─────────────────────────────────────────────────────────────────────────
  // USER CONTEXT (NEW in V2)
  // ─────────────────────────────────────────────────────────────────────────
  user: {
    subscriberId: string;
    tier: UserTier;
    totalGenerationsAtTime: number;
    avgRatingGiven: number;
    preferredTone?: ToneHint;
    preferredNiche?: string;
    sessionId: string;
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // VARIATION CONTEXT (NEW in V2)
  // ─────────────────────────────────────────────────────────────────────────
  variation: {
    index: number;
    previousScriptIds: string[];
    isRedo: boolean;
    triggerType: TriggerType;
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // INPUT FEATURES
  // ─────────────────────────────────────────────────────────────────────────
  input: {
    videoUrl: string;
    userIdea: string;
    isDefaultIdea: boolean;
    requestHash: string;
    
    // Hints
    toneHint?: ToneHint;
    languageHint?: string;
    mode: GenerationMode;
    
    // Video analysis
    transcript?: string;
    transcriptLanguage?: string;
    transcriptWordCount?: number;
    visualCues: string[];
    hookType?: string;
    detectedTone?: string;
    sceneDescriptions: string[];
    videoDurationSeconds?: number;
    frameCount?: number;
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // CONTENT CLASSIFICATION (NEW in V2)
  // ─────────────────────────────────────────────────────────────────────────
  classification: {
    niche: string;
    contentType: ContentType;
    targetAudience?: string;
    detectedHashtags?: string[];
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // OUTPUT FEATURES
  // ─────────────────────────────────────────────────────────────────────────
  output: {
    generatedScript: string;
    scriptSections: {
      hook?: string;
      body?: string;
      cta?: string;
    };
    visualDirections: string[];
    dialogueLines: string[];
    scriptLengthChars: number;
    estimatedSpokenDuration?: number;
    hookLengthChars?: number;
    bodyLengthChars?: number;
    ctaLengthChars?: number;
    
    // Carousel output (NEW in V2)
    carouselDelivered: boolean;
    imageUrls: {
      hook?: string;
      body?: string;
      cta?: string;
      combined?: string;
    };
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // EXPERIMENT TRACKING (NEW in V2)
  // ─────────────────────────────────────────────────────────────────────────
  experiment: {
    promptVariantId: string;
    systemPromptHash: string;
    temperature: number;
    topP?: number;
    maxTokens?: number;
    modelConfig: Record<string, any>;
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // ALTERNATIVES FOR RLHF (NEW in V2)
  // ─────────────────────────────────────────────────────────────────────────
  alternatives?: {
    candidateScripts: string[];
    selectedIndex?: number;
    rejectionReasons?: string[];
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // USER FEEDBACK
  // ─────────────────────────────────────────────────────────────────────────
  feedback: {
    overallRating?: number;
    wasAccepted: boolean;
    acceptedAt?: Date;
    
    sectionFeedback: {
      hook?: { rating?: number; wasRegenerated: boolean; regenerationReason?: string };
      body?: { rating?: number; wasRegenerated: boolean; regenerationReason?: string };
      cta?: { rating?: number; wasRegenerated: boolean; regenerationReason?: string };
    };
    
    feedbackText?: string;
    
    videoPerformance?: {
      views?: number;
      likes?: number;
      comments?: number;
      shares?: number;
      reportedAt?: Date;
    };
    
    // Implicit signals (NEW in V2)
    implicit: {
      timeToFirstInteraction?: number;
      didCopy: boolean;
      copyCount: number;
      didRedo: boolean;
      sessionEndedAfter: boolean;
    };
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // EDITS TRACKING (NEW in V2)
  // ─────────────────────────────────────────────────────────────────────────
  edits?: {
    userEditedScript?: string;
    editDistance: number;
    editedSections: string[];
    timeToFirstEdit?: number;
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // FAILURE TRACKING (NEW in V2)
  // ─────────────────────────────────────────────────────────────────────────
  failures: {
    failedAttempts: Array<{
      attemptNumber: number;
      script?: string;
      failureReason: 'timeout' | 'content_filter' | 'api_error' | 'quality_gate' | 'user_rejected';
      errorMessage?: string;
      timestamp: Date;
    }>;
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // QUALITY METRICS
  // ─────────────────────────────────────────────────────────────────────────
  qualityMetrics: {
    overallScore: number;
    hookStrength?: number;
    ctaClarity?: number;
    pacing?: number;
    originalityScore?: number;
    grammarScore?: number;
    predictedEngagement?: number;
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // GENERATION METADATA
  // ─────────────────────────────────────────────────────────────────────────
  generation: {
    analysisModel: string;
    scriptModel: string;
    analysisTimeMs: number;
    generationTimeMs: number;
    imageGenerationTimeMs: number;
    totalTimeMs: number;
    analysisAttempts: number;
    generationAttempts: number;
    promptVersion: string;
    
    // Cache performance (NEW in V2)
    tier1CacheHit: boolean;
    tier2CacheHit: boolean;
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // ML TRAINING FLAGS
  // ─────────────────────────────────────────────────────────────────────────
  training: {
    isValidated: boolean;
    qualityScore: number;
    includedInTraining: boolean;
    trainingBatch?: string;
    datasetVersion: string;
    exportedAt?: Date;
  };
  
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

const DatasetEntryV2Schema = new Schema<IDatasetEntryV2>(
  {
    schemaVersion: { type: String, default: '2.0', index: true },
    
    // User Context
    user: {
      subscriberId: { type: String, required: true, index: true },
      tier: { type: String, enum: ['free', 'beta', 'premium', 'enterprise'], default: 'free' },
      totalGenerationsAtTime: { type: Number, default: 0 },
      avgRatingGiven: { type: Number, default: 0 },
      preferredTone: { type: String, enum: ['professional', 'funny', 'provocative', 'educational', 'casual'] },
      preferredNiche: { type: String },
      sessionId: { type: String, index: true },
    },
    
    // Variation Context
    variation: {
      index: { type: Number, default: 0 },
      previousScriptIds: [{ type: String }],
      isRedo: { type: Boolean, default: false },
      triggerType: { type: String, enum: ['guided', 'instant', 'redo'], default: 'guided' },
    },
    
    // Input Features
    input: {
      videoUrl: { type: String, required: true },
      userIdea: { type: String, required: true },
      isDefaultIdea: { type: Boolean, default: false },
      requestHash: { type: String, required: true, index: true },
      toneHint: { type: String, enum: ['professional', 'funny', 'provocative', 'educational', 'casual'] },
      languageHint: { type: String },
      mode: { type: String, enum: ['full', 'hook_only'], default: 'full' },
      transcript: { type: String },
      transcriptLanguage: { type: String },
      transcriptWordCount: { type: Number },
      visualCues: [{ type: String }],
      hookType: { type: String },
      detectedTone: { type: String },
      sceneDescriptions: [{ type: String }],
      videoDurationSeconds: { type: Number },
      frameCount: { type: Number },
    },
    
    // Classification
    classification: {
      niche: { type: String, default: 'general' },
      contentType: { 
        type: String, 
        enum: ['educational', 'promotional', 'entertainment', 'storytelling', 'motivational', 'other'],
        default: 'other' 
      },
      targetAudience: { type: String },
      detectedHashtags: [{ type: String }],
    },
    
    // Output Features
    output: {
      generatedScript: { type: String, required: true },
      scriptSections: {
        hook: { type: String },
        body: { type: String },
        cta: { type: String },
      },
      visualDirections: [{ type: String }],
      dialogueLines: [{ type: String }],
      scriptLengthChars: { type: Number },
      estimatedSpokenDuration: { type: Number },
      hookLengthChars: { type: Number },
      bodyLengthChars: { type: Number },
      ctaLengthChars: { type: Number },
      carouselDelivered: { type: Boolean, default: false },
      imageUrls: {
        hook: { type: String },
        body: { type: String },
        cta: { type: String },
        combined: { type: String },
      },
    },
    
    // Experiment Tracking
    experiment: {
      promptVariantId: { type: String, default: 'default' },
      systemPromptHash: { type: String },
      temperature: { type: Number, default: 0.7 },
      topP: { type: Number },
      maxTokens: { type: Number },
      modelConfig: { type: Schema.Types.Mixed, default: {} },
    },
    
    // Alternatives
    alternatives: {
      candidateScripts: [{ type: String }],
      selectedIndex: { type: Number },
      rejectionReasons: [{ type: String }],
    },
    
    // Feedback
    feedback: {
      overallRating: { type: Number, min: 1, max: 5 },
      wasAccepted: { type: Boolean, default: false },
      acceptedAt: { type: Date },
      sectionFeedback: {
        hook: {
          rating: { type: Number, min: 1, max: 5 },
          wasRegenerated: { type: Boolean, default: false },
          regenerationReason: { type: String },
        },
        body: {
          rating: { type: Number, min: 1, max: 5 },
          wasRegenerated: { type: Boolean, default: false },
          regenerationReason: { type: String },
        },
        cta: {
          rating: { type: Number, min: 1, max: 5 },
          wasRegenerated: { type: Boolean, default: false },
          regenerationReason: { type: String },
        },
      },
      feedbackText: { type: String, maxlength: 2000 },
      videoPerformance: {
        views: { type: Number },
        likes: { type: Number },
        comments: { type: Number },
        shares: { type: Number },
        reportedAt: { type: Date },
      },
      implicit: {
        timeToFirstInteraction: { type: Number },
        didCopy: { type: Boolean, default: false },
        copyCount: { type: Number, default: 0 },
        didRedo: { type: Boolean, default: false },
        sessionEndedAfter: { type: Boolean, default: false },
      },
    },
    
    // Edits
    edits: {
      userEditedScript: { type: String },
      editDistance: { type: Number, default: 0 },
      editedSections: [{ type: String }],
      timeToFirstEdit: { type: Number },
    },
    
    // Failures
    failures: {
      failedAttempts: [{
        attemptNumber: { type: Number },
        script: { type: String },
        failureReason: { 
          type: String, 
          enum: ['timeout', 'content_filter', 'api_error', 'quality_gate', 'user_rejected'] 
        },
        errorMessage: { type: String },
        timestamp: { type: Date },
      }],
    },
    
    // Quality Metrics
    qualityMetrics: {
      overallScore: { type: Number, default: 50, min: 0, max: 100 },
      hookStrength: { type: Number, min: 0, max: 100 },
      ctaClarity: { type: Number, min: 0, max: 100 },
      pacing: { type: Number, min: 0, max: 100 },
      originalityScore: { type: Number, min: 0, max: 100 },
      grammarScore: { type: Number, min: 0, max: 100 },
      predictedEngagement: { type: Number, min: 0, max: 100 },
    },
    
    // Generation Metadata
    generation: {
      analysisModel: { type: String },
      scriptModel: { type: String },
      analysisTimeMs: { type: Number },
      generationTimeMs: { type: Number },
      imageGenerationTimeMs: { type: Number },
      totalTimeMs: { type: Number },
      analysisAttempts: { type: Number, default: 1 },
      generationAttempts: { type: Number, default: 1 },
      promptVersion: { type: String },
      tier1CacheHit: { type: Boolean, default: false },
      tier2CacheHit: { type: Boolean, default: false },
    },
    
    // Training Flags
    training: {
      isValidated: { type: Boolean, default: false },
      qualityScore: { type: Number, default: 50 },
      includedInTraining: { type: Boolean, default: false },
      trainingBatch: { type: String },
      datasetVersion: { type: String, default: '2.0' },
      exportedAt: { type: Date },
    },
  },
  {
    timestamps: true,
    collection: 'dataset_v2',
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// User queries
DatasetEntryV2Schema.index({ 'user.subscriberId': 1, createdAt: -1 });

// Variation queries
DatasetEntryV2Schema.index({ 'variation.index': 1 });

// Classification queries
DatasetEntryV2Schema.index({ 'classification.niche': 1 });
DatasetEntryV2Schema.index({ 'classification.contentType': 1 });

// Quality sorting
DatasetEntryV2Schema.index({ 'qualityMetrics.overallScore': -1 });

// Training export
DatasetEntryV2Schema.index({ 
  'training.includedInTraining': 1, 
  'training.qualityScore': -1 
});

// Feedback queries
DatasetEntryV2Schema.index({ 'feedback.overallRating': 1 });
DatasetEntryV2Schema.index({ 'feedback.wasAccepted': 1 });

// ═══════════════════════════════════════════════════════════════════════════
// QUALITY SCORE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate quality score based on all available signals
 * Called after feedback update
 */
DatasetEntryV2Schema.methods.calculateQualityScore = function(): number {
  let score = 50; // Base score
  
  const feedback = this.feedback;
  
  // User rating (+/- 30 points)
  if (feedback.overallRating) {
    score += (feedback.overallRating - 3) * 15;
  }
  
  // Acceptance (+20 points)
  if (feedback.wasAccepted) {
    score += 20;
  }
  
  // No regenerations (+15 points max)
  const sections = feedback.sectionFeedback || {};
  if (!sections.hook?.wasRegenerated) score += 5;
  if (!sections.body?.wasRegenerated) score += 5;
  if (!sections.cta?.wasRegenerated) score += 5;
  
  // Implicit signals
  const implicit = feedback.implicit || {};
  if (implicit.didCopy) score += 10;
  if (implicit.copyCount > 1) score += 5;
  if (implicit.didRedo) score -= 10; // Penalty for redo
  if (implicit.sessionEndedAfter) score -= 5; // Might indicate dissatisfaction
  
  // Video performance
  const perf = feedback.videoPerformance || {};
  if (perf.views && perf.views > 10000) score += 10;
  if (perf.likes && perf.views && (perf.likes / perf.views) > 0.1) score += 10;
  
  // Input richness
  if (this.input.transcript) score += 5;
  if ((this.input.visualCues?.length || 0) > 3) score += 5;
  
  // Clamp to 0-100
  return Math.max(0, Math.min(100, score));
};

// ═══════════════════════════════════════════════════════════════════════════
// MODEL EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const DatasetEntryV2: Model<IDatasetEntryV2> = mongoose.model<IDatasetEntryV2>(
  'DatasetEntryV2',
  DatasetEntryV2Schema
);

export default DatasetEntryV2;
