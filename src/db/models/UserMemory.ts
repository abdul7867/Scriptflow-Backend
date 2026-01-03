/**
 * UserMemory - Persistent user preferences and history
 * 
 * ScriptFlow 2.0 - Learn from user behavior for personalization
 * 
 * Stores:
 * - Learned preferences (tone, niche, language)
 * - Usage statistics for calibration
 * - Recent history for context
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ToneHint = 'professional' | 'funny' | 'provocative' | 'educational' | 'casual';

export interface IUserMemory extends Document {
  /** ManyChat subscriber ID - primary key */
  subscriberId: string;
  
  /** Learned preferences from usage patterns */
  preferences: {
    /** Most commonly requested/successful tone */
    preferredTone?: ToneHint;
    
    /** Content niches user frequently creates for */
    preferredNiches: string[];
    
    /** Preferred dialogue language */
    preferredLanguage?: string;
    
    /** Average script length user prefers (chars) */
    avgScriptLength: number;
    
    /** Whether user typically wants full scripts or hooks only */
    preferredMode: 'full' | 'hook_only' | 'mixed';
  };
  
  /** Usage statistics for calibration */
  stats: {
    /** Total scripts generated */
    totalGenerations: number;
    
    /** Total redo/variation requests */
    totalRedos: number;
    
    /** Average rating this user gives (for calibration) */
    avgRatingGiven: number;
    
    /** Number of ratings submitted */
    ratingCount: number;
    
    /** Total positive feedbacks */
    positiveCount: number;
    
    /** Total negative feedbacks */
    negativeCount: number;
    
    /** Last active timestamp */
    lastActiveAt: Date;
    
    /** First seen timestamp */
    firstSeenAt: Date;
  };
  
  /** Recent generation history for context */
  recentHistory: Array<{
    reelUrl: string;
    idea: string;
    scriptId: string;
    rating?: number;
    wasRedo: boolean;
    createdAt: Date;
  }>;
  
  /** Blocked reels (user explicitly said don't use) */
  blockedReels?: string[];
  
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

const UserMemorySchema = new Schema<IUserMemory>(
  {
    subscriberId: { 
      type: String, 
      required: true, 
      unique: true,
      index: true,
    },
    
    preferences: {
      preferredTone: { 
        type: String, 
        enum: ['professional', 'funny', 'provocative', 'educational', 'casual'] 
      },
      preferredNiches: [{ type: String }],
      preferredLanguage: { type: String },
      avgScriptLength: { type: Number, default: 0 },
      preferredMode: { 
        type: String, 
        enum: ['full', 'hook_only', 'mixed'], 
        default: 'full' 
      },
    },
    
    stats: {
      totalGenerations: { type: Number, default: 0 },
      totalRedos: { type: Number, default: 0 },
      avgRatingGiven: { type: Number, default: 0 },
      ratingCount: { type: Number, default: 0 },
      positiveCount: { type: Number, default: 0 },
      negativeCount: { type: Number, default: 0 },
      lastActiveAt: { type: Date, default: Date.now },
      firstSeenAt: { type: Date, default: Date.now },
    },
    
    recentHistory: [{
      reelUrl: { type: String, required: true },
      idea: { type: String, required: true },
      scriptId: { type: String, required: true },
      rating: { type: Number, min: 1, max: 5 },
      wasRedo: { type: Boolean, default: false },
      createdAt: { type: Date, default: Date.now },
    }],
    
    blockedReels: [{ type: String }],
  },
  {
    timestamps: true,
    collection: 'user_memory',
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Activity-based queries
UserMemorySchema.index({ 'stats.lastActiveAt': -1 });

// Cleanup of inactive users
UserMemorySchema.index({ 'stats.lastActiveAt': 1 });

// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get or create user memory
 */
UserMemorySchema.statics.getOrCreate = async function(
  subscriberId: string
): Promise<IUserMemory> {
  let memory = await this.findOne({ subscriberId });
  
  if (!memory) {
    memory = await this.create({
      subscriberId,
      preferences: {
        preferredNiches: [],
        avgScriptLength: 0,
        preferredMode: 'full',
      },
      stats: {
        totalGenerations: 0,
        totalRedos: 0,
        avgRatingGiven: 0,
        ratingCount: 0,
        positiveCount: 0,
        negativeCount: 0,
        lastActiveAt: new Date(),
        firstSeenAt: new Date(),
      },
      recentHistory: [],
    });
  }
  
  return memory;
};

/**
 * Record a new generation
 */
UserMemorySchema.statics.recordGeneration = async function(
  subscriberId: string,
  reelUrl: string,
  idea: string,
  scriptId: string,
  wasRedo: boolean = false
): Promise<void> {
  const memory = await (this as any).getOrCreate(subscriberId);
  
  // Update stats
  memory.stats.totalGenerations += 1;
  if (wasRedo) {
    memory.stats.totalRedos += 1;
  }
  memory.stats.lastActiveAt = new Date();
  
  // Add to history (keep last 10)
  memory.recentHistory.unshift({
    reelUrl,
    idea,
    scriptId,
    wasRedo,
    createdAt: new Date(),
  });
  
  // Trim history to last 10
  if (memory.recentHistory.length > 10) {
    memory.recentHistory = memory.recentHistory.slice(0, 10);
  }
  
  await memory.save();
};

/**
 * Record feedback
 */
UserMemorySchema.statics.recordFeedback = async function(
  subscriberId: string,
  scriptId: string,
  rating?: number,
  isPositive?: boolean
): Promise<void> {
  const memory = await (this as any).getOrCreate(subscriberId);
  
  // Update rating stats
  if (rating !== undefined) {
    const totalRating = memory.stats.avgRatingGiven * memory.stats.ratingCount;
    memory.stats.ratingCount += 1;
    memory.stats.avgRatingGiven = (totalRating + rating) / memory.stats.ratingCount;
    
    // Update history entry
    const historyEntry = memory.recentHistory.find((h: any) => h.scriptId === scriptId);
    if (historyEntry) {
      historyEntry.rating = rating;
    }
  }
  
  // Track positive/negative
  if (isPositive === true) {
    memory.stats.positiveCount += 1;
  } else if (isPositive === false) {
    memory.stats.negativeCount += 1;
  }
  
  memory.stats.lastActiveAt = new Date();
  await memory.save();
};

/**
 * Update learned preferences based on usage patterns
 */
UserMemorySchema.statics.updatePreferences = async function(
  subscriberId: string,
  updates: Partial<IUserMemory['preferences']>
): Promise<void> {
  await this.updateOne(
    { subscriberId },
    { 
      $set: { 
        ...Object.entries(updates).reduce((acc, [key, value]) => {
          acc[`preferences.${key}`] = value;
          return acc;
        }, {} as Record<string, any>),
        'stats.lastActiveAt': new Date(),
      }
    },
    { upsert: true }
  );
};

/**
 * Learn preferred tone from successful generations
 */
UserMemorySchema.statics.learnTone = async function(
  subscriberId: string,
  tone: ToneHint,
  wasSuccessful: boolean
): Promise<void> {
  if (!wasSuccessful) return;
  
  const memory = await (this as any).getOrCreate(subscriberId);
  
  // Simple: if user rated highly, adopt their tone
  // More sophisticated: track tone frequency and success rate
  if (!memory.preferences.preferredTone) {
    memory.preferences.preferredTone = tone;
    await memory.save();
  }
};

/**
 * Learn preferred niche from content patterns
 */
UserMemorySchema.statics.learnNiche = async function(
  subscriberId: string,
  niche: string
): Promise<void> {
  if (!niche || niche === 'general') return;
  
  await this.updateOne(
    { subscriberId },
    { 
      $addToSet: { 'preferences.preferredNiches': niche },
      $set: { 'stats.lastActiveAt': new Date() }
    },
    { upsert: true }
  );
};

/**
 * Get user context for personalization
 */
UserMemorySchema.statics.getUserContext = async function(
  subscriberId: string
): Promise<{
  tier: string;
  totalGenerations: number;
  avgRating: number;
  preferredTone?: ToneHint;
  preferredNiches: string[];
  recentReels: string[];
}> {
  const memory = await (this as any).getOrCreate(subscriberId);
  
  return {
    tier: memory.stats.totalGenerations > 50 ? 'power' : 
          memory.stats.totalGenerations > 10 ? 'regular' : 'new',
    totalGenerations: memory.stats.totalGenerations,
    avgRating: memory.stats.avgRatingGiven,
    preferredTone: memory.preferences.preferredTone,
    preferredNiches: memory.preferences.preferredNiches,
    recentReels: memory.recentHistory.slice(0, 5).map((h: any) => h.reelUrl),
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// MODEL EXPORT
// ═══════════════════════════════════════════════════════════════════════════

interface UserMemoryModel extends Model<IUserMemory> {
  getOrCreate(subscriberId: string): Promise<IUserMemory>;
  recordGeneration(
    subscriberId: string, 
    reelUrl: string, 
    idea: string, 
    scriptId: string, 
    wasRedo?: boolean
  ): Promise<void>;
  recordFeedback(
    subscriberId: string, 
    scriptId: string, 
    rating?: number, 
    isPositive?: boolean
  ): Promise<void>;
  updatePreferences(
    subscriberId: string, 
    updates: Partial<IUserMemory['preferences']>
  ): Promise<void>;
  learnTone(subscriberId: string, tone: ToneHint, wasSuccessful: boolean): Promise<void>;
  learnNiche(subscriberId: string, niche: string): Promise<void>;
  getUserContext(subscriberId: string): Promise<{
    tier: string;
    totalGenerations: number;
    avgRating: number;
    preferredTone?: ToneHint;
    preferredNiches: string[];
    recentReels: string[];
  }>;
}

export const UserMemory = mongoose.model<IUserMemory, UserMemoryModel>(
  'UserMemory',
  UserMemorySchema
);

export default UserMemory;
