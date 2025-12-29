import mongoose, { Schema, Document } from 'mongoose';
import { VideoAnalysis } from '../../services/videoAnalyzer';

/**
 * ReelDNA Document Interface
 * Tier 1 Cache: Stores video analysis results for reuse with different user ideas
 */
export interface IReelDNA extends Document {
  reelUrlHash: string;       // SHA-256 of the reel URL (unique key)
  reelUrl: string;           // Original URL for reference
  analysis: VideoAnalysis;   // The cached video analysis
  createdAt: Date;
  expiresAt: Date;           // Cache expiration (e.g., 7 days)
}

const ReelDNASchema = new Schema<IReelDNA>({
  reelUrlHash: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  reelUrl: { 
    type: String, 
    required: true 
  },
  analysis: {
    transcript: { type: String, default: null },
    visualCues: [{ type: String }],
    hookType: { type: String },
    tone: { type: String },
    sceneDescriptions: [{ type: String }]
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    index: true
  }
}, {
  timestamps: true
});

// TTL index for automatic cleanup of expired cache entries
ReelDNASchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ReelDNA = mongoose.model<IReelDNA>('ReelDNA', ReelDNASchema);
