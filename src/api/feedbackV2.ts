/**
 * ScriptFlow 2.0 - Enhanced Feedback API
 * 
 * Collects comprehensive feedback for ML training:
 * - Overall ratings and section feedback
 * - Implicit signals (redo requests, edits)
 * - Video performance metrics
 * - User preference learning
 * 
 * Also updates:
 * - DatasetV2 with enhanced feedback schema
 * - UserMemory for preference learning
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger';

// Database
import { DatasetEntry, computeQualityScore } from '../db/models/Dataset';
import { DatasetEntryV2 } from '../db/models/DatasetV2';
import { UserMemory } from '../db/models/UserMemory';
import { Script } from '../db/models';

// Metrics
import { recordFeedback } from './metrics';

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const feedbackSchemaV2 = z.object({
  // Identifiers
  request_hash: z.string(),
  subscriber_id: z.string(),
  
  // Explicit feedback
  overall_rating: z.number().min(1).max(5).optional(),
  feedback_type: z.enum(['positive', 'negative', 'redo', 'edit']).optional(),
  feedback_text: z.string().max(500).optional(),
  
  // Section feedback
  section_feedback: z.object({
    hook: z.object({
      rating: z.number().min(1).max(5).optional(),
      regeneration_reason: z.string().optional(),
      edited_version: z.string().optional(),
    }).optional(),
    body: z.object({
      rating: z.number().min(1).max(5).optional(),
      regeneration_reason: z.string().optional(),
      edited_version: z.string().optional(),
    }).optional(),
    cta: z.object({
      rating: z.number().min(1).max(5).optional(),
      regeneration_reason: z.string().optional(),
      edited_version: z.string().optional(),
    }).optional(),
  }).optional(),
  
  // Implicit signals
  implicit_signals: z.object({
    copied_script: z.boolean().optional(),
    clicked_link: z.boolean().optional(),
    time_spent_viewing_ms: z.number().optional(),
    requested_redo: z.boolean().optional(),
    redo_count: z.number().optional(),
  }).optional(),
  
  // Video performance (if user reports later)
  video_performance: z.object({
    views: z.number().optional(),
    likes: z.number().optional(),
    comments: z.number().optional(),
    shares: z.number().optional(),
    saves: z.number().optional(),
    watch_time_seconds: z.number().optional(),
    retention_rate: z.number().min(0).max(100).optional(),
  }).optional(),
  
  // Preference learning signals
  preferences: z.object({
    preferred_tone: z.string().optional(),
    preferred_niche: z.string().optional(),
  }).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════
// ENHANCED FEEDBACK HANDLER V2
// ═══════════════════════════════════════════════════════════════════════════

export const submitFeedbackHandlerV2 = async (req: Request, res: Response) => {
  try {
    // 1. Validate request
    const parseResult = feedbackSchemaV2.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_INPUT',
        message: parseResult.error.issues.map((e: any) => e.message).join(', ')
      });
    }

    const {
      request_hash,
      subscriber_id,
      overall_rating,
      feedback_type,
      feedback_text,
      section_feedback,
      implicit_signals,
      video_performance,
      preferences,
    } = parseResult.data;

    // 2. Find entries in both schemas (for migration support)
    const [entryV1, entryV2] = await Promise.all([
      DatasetEntry.findOne({ 'input.requestHash': request_hash }),
      DatasetEntryV2.findOne({ requestHash: request_hash }),
    ]);

    if (!entryV1 && !entryV2) {
      return res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Script not found. Feedback can only be submitted for existing scripts.'
      });
    }

    // 3. Record metrics
    if (feedback_type) {
      recordFeedback(feedback_type as 'positive' | 'negative' | 'redo');
    } else if (overall_rating) {
      recordFeedback(overall_rating >= 4 ? 'positive' : 'negative');
    }

    // 4. Update DatasetV2 (enhanced schema)
    if (entryV2) {
      await updateDatasetV2(entryV2, {
        overall_rating,
        feedback_text,
        section_feedback,
        implicit_signals,
        video_performance,
      });
    }

    // 5. Update legacy DatasetEntry (for backwards compatibility)
    if (entryV1) {
      await updateDatasetV1(entryV1, {
        overall_rating,
        feedback_text,
        section_feedback,
        video_performance,
      });
    }

    // 6. Update UserMemory for preference learning
    if (subscriber_id) {
      await updateUserMemory(subscriber_id, {
        overall_rating,
        feedback_type,
        preferences,
        section_feedback,
        request_hash,
      });
    }

    // 7. Get final quality score
    const qualityScore = entryV2 
      ? entryV2.qualityMetrics?.overallScore || 0
      : entryV1?.training?.qualityScore || 0;

    logger.info(`Feedback received for ${request_hash}: type=${feedback_type}, rating=${overall_rating}, quality=${qualityScore}`);

    res.json({
      status: 'success',
      message: 'Thank you for your feedback! 🙏',
      qualityScore,
      feedback_type,
    });

  } catch (error) {
    logger.error('Failed to submit feedback:', error);
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to submit feedback'
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function updateDatasetV2(entry: any, feedback: any): Promise<void> {
  const { overall_rating, feedback_text, section_feedback, implicit_signals, video_performance } = feedback;
  
  // Update explicit feedback
  if (overall_rating !== undefined) {
    entry.feedback = entry.feedback || {};
    entry.feedback.explicitRating = overall_rating;
    entry.feedback.sentimentLabel = overall_rating >= 4 ? 'positive' : overall_rating >= 3 ? 'neutral' : 'negative';
    entry.feedback.collectedAt = new Date();
  }
  
  if (feedback_text) {
    entry.feedback = entry.feedback || {};
    entry.feedback.freeTextFeedback = feedback_text;
  }
  
  // Update section feedback
  if (section_feedback) {
    entry.feedback = entry.feedback || {};
    entry.feedback.sectionRatings = {
      hook: section_feedback.hook?.rating,
      body: section_feedback.body?.rating,
      cta: section_feedback.cta?.rating,
    };
  }
  
  // Update implicit signals
  if (implicit_signals) {
    entry.feedback = entry.feedback || {};
    entry.feedback.implicitSignals = {
      ...entry.feedback.implicitSignals,
      ...implicit_signals,
    };
  }
  
  // Update edits tracking
  if (section_feedback) {
    const editedSections: string[] = [];
    
    if (section_feedback.hook?.edited_version) {
      editedSections.push('hook');
      entry.edits = entry.edits || {};
      entry.edits.userEditedScript = entry.edits.userEditedScript || '';
      entry.edits.editType = 'partial';
      entry.edits.editReason = section_feedback.hook.regeneration_reason || 'user_edit';
    }
    if (section_feedback.body?.edited_version) {
      editedSections.push('body');
    }
    if (section_feedback.cta?.edited_version) {
      editedSections.push('cta');
    }
    
    if (editedSections.length > 0) {
      entry.edits = entry.edits || {};
      entry.edits.editedSections = editedSections;
      entry.edits.editedAt = new Date();
    }
  }
  
  // Update video performance
  if (video_performance) {
    entry.feedback = entry.feedback || {};
    entry.feedback.videoPerformance = {
      views: video_performance.views,
      likes: video_performance.likes,
      comments: video_performance.comments,
      shares: video_performance.shares,
      saves: video_performance.saves,
      watchTimeSeconds: video_performance.watch_time_seconds,
      retentionRate: video_performance.retention_rate,
      reportedAt: new Date(),
    };
  }
  
  // Recalculate quality score using the schema method
  entry.qualityMetrics = entry.qualityMetrics || {};
  if (typeof entry.calculateQualityScore === 'function') {
    entry.qualityMetrics.overallScore = entry.calculateQualityScore();
  } else {
    // Fallback simple calculation
    entry.qualityMetrics.overallScore = overall_rating ? overall_rating * 20 : 50;
  }
  entry.qualityMetrics.lastCalculatedAt = new Date();
  
  // Update training flags
  entry.trainingFlags = entry.trainingFlags || {};
  entry.trainingFlags.isValidated = overall_rating !== undefined;
  entry.trainingFlags.includeInTraining = entry.qualityMetrics.overallScore >= 60;
  
  await entry.save();
}

async function updateDatasetV1(entry: any, feedback: any): Promise<void> {
  const { overall_rating, feedback_text, section_feedback, video_performance } = feedback;
  
  if (overall_rating !== undefined) {
    entry.feedback.overallRating = overall_rating;
    entry.feedback.wasAccepted = overall_rating >= 4;
  }
  
  if (feedback_text) {
    entry.feedback.feedbackText = feedback_text;
  }
  
  if (section_feedback) {
    if (section_feedback.hook) {
      entry.feedback.sectionFeedback.hook = {
        rating: section_feedback.hook.rating,
        wasRegenerated: !!section_feedback.hook.regeneration_reason,
        regenerationReason: section_feedback.hook.regeneration_reason,
      };
    }
    if (section_feedback.body) {
      entry.feedback.sectionFeedback.body = {
        rating: section_feedback.body.rating,
        wasRegenerated: !!section_feedback.body.regeneration_reason,
        regenerationReason: section_feedback.body.regeneration_reason,
      };
    }
    if (section_feedback.cta) {
      entry.feedback.sectionFeedback.cta = {
        rating: section_feedback.cta.rating,
        wasRegenerated: !!section_feedback.cta.regeneration_reason,
        regenerationReason: section_feedback.cta.regeneration_reason,
      };
    }
  }
  
  if (video_performance) {
    entry.feedback.videoPerformance = {
      views: video_performance.views,
      likes: video_performance.likes,
      comments: video_performance.comments,
      shares: video_performance.shares,
      reportedAt: new Date(),
    };
  }
  
  entry.training.qualityScore = computeQualityScore(entry);
  
  await entry.save();
}

async function updateUserMemory(
  subscriberId: string,
  feedback: any
): Promise<void> {
  const { overall_rating, feedback_type, preferences, section_feedback, request_hash } = feedback;
  
  try {
    // Record feedback
    if (overall_rating !== undefined || feedback_type) {
      await UserMemory.recordFeedback(
        subscriberId,
        request_hash,
        overall_rating || (feedback_type === 'positive' ? 5 : feedback_type === 'negative' ? 2 : 3),
        feedback_type === 'redo'
      );
    }
    
    // Learn tone preference
    if (preferences?.preferred_tone) {
      await UserMemory.learnTone(subscriberId, preferences.preferred_tone, true);
    }
    
    // Learn niche preference
    if (preferences?.preferred_niche) {
      await UserMemory.learnNiche(subscriberId, preferences.preferred_niche);
    }
  } catch (error) {
    logger.warn(`Failed to update user memory for ${subscriberId}:`, error);
    // Non-critical, don't throw
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STATS HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export const getFeedbackStatsHandlerV2 = async (req: Request, res: Response) => {
  try {
    // Get stats from both schemas
    const [v1Stats, v2Stats] = await Promise.all([
      // V1 stats
      Promise.all([
        DatasetEntry.countDocuments(),
        DatasetEntry.countDocuments({ 'feedback.overallRating': { $exists: true } }),
        DatasetEntry.aggregate([
          { $match: { 'feedback.overallRating': { $exists: true } } },
          { $group: { _id: null, avg: { $avg: '$feedback.overallRating' } } }
        ]),
        DatasetEntry.countDocuments({ 'feedback.wasAccepted': false }),
        DatasetEntry.countDocuments({ 'training.qualityScore': { $gte: 70 } }),
      ]),
      // V2 stats
      Promise.all([
        DatasetEntryV2.countDocuments(),
        DatasetEntryV2.countDocuments({ 'feedback.explicitRating': { $exists: true } }),
        DatasetEntryV2.aggregate([
          { $match: { 'feedback.explicitRating': { $exists: true } } },
          { $group: { _id: null, avg: { $avg: '$feedback.explicitRating' } } }
        ]),
        DatasetEntryV2.countDocuments({ 'feedback.sentimentLabel': 'negative' }),
        DatasetEntryV2.countDocuments({ 'qualityMetrics.overallScore': { $gte: 70 } }),
        // Additional V2 stats
        DatasetEntryV2.aggregate([
          { $group: { 
            _id: '$classification.contentCategory', 
            count: { $sum: 1 } 
          }}
        ]),
        DatasetEntryV2.aggregate([
          { $group: { 
            _id: '$feedback.sentimentLabel', 
            count: { $sum: 1 } 
          }}
        ]),
      ]),
    ]);

    const [v1Total, v1Rated, v1AvgRating, v1Regenerated, v1HighQuality] = v1Stats;
    const [v2Total, v2Rated, v2AvgRating, v2Negative, v2HighQuality, v2Categories, v2Sentiments] = v2Stats;

    const totalEntries = v1Total + v2Total;
    const totalRated = v1Rated + v2Rated;
    const avgRating = v1AvgRating[0]?.avg || v2AvgRating[0]?.avg || 0;
    const highQualityTotal = v1HighQuality + v2HighQuality;

    res.json({
      status: 'success',
      stats: {
        // Combined stats
        totalEntries,
        totalRated,
        averageRating: avgRating.toFixed(2),
        highQualityCount: highQualityTotal,
        qualityRate: totalEntries > 0 
          ? ((highQualityTotal / totalEntries) * 100).toFixed(1) + '%'
          : 'N/A',
        
        // Schema breakdown
        v1: {
          total: v1Total,
          rated: v1Rated,
          regenerated: v1Regenerated,
          highQuality: v1HighQuality,
        },
        v2: {
          total: v2Total,
          rated: v2Rated,
          negative: v2Negative,
          highQuality: v2HighQuality,
          byCategory: Object.fromEntries(
            (v2Categories as any[]).map(c => [c._id || 'unknown', c.count])
          ),
          bySentiment: Object.fromEntries(
            (v2Sentiments as any[]).map(s => [s._id || 'unrated', s.count])
          ),
        },
      }
    });

  } catch (error) {
    logger.error('Failed to get feedback stats:', error);
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to get stats'
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// QUICK FEEDBACK (for redo/emoji responses)
// ═══════════════════════════════════════════════════════════════════════════

export const quickFeedbackHandler = async (req: Request, res: Response) => {
  try {
    const { subscriber_id, request_hash, action } = req.body;
    
    if (!subscriber_id || !action) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_INPUT',
        message: 'subscriber_id and action are required'
      });
    }
    
    // Map action to feedback type
    const feedbackMap: Record<string, { type: string; rating: number }> = {
      'thumbs_up': { type: 'positive', rating: 5 },
      'thumbs_down': { type: 'negative', rating: 2 },
      'fire': { type: 'positive', rating: 5 },
      'redo': { type: 'redo', rating: 3 },
      'love': { type: 'positive', rating: 5 },
      'meh': { type: 'negative', rating: 3 },
    };
    
    const feedbackInfo = feedbackMap[action];
    if (!feedbackInfo) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_ACTION',
        message: 'Unknown feedback action'
      });
    }
    
    // Record metrics
    recordFeedback(feedbackInfo.type as 'positive' | 'negative' | 'redo');
    
    // Update UserMemory
    if (request_hash) {
      await UserMemory.recordFeedback(
        subscriber_id,
        request_hash,
        feedbackInfo.rating,
        action === 'redo'
      );
    }
    
    // Update DatasetV2 if we have the hash
    if (request_hash) {
      await DatasetEntryV2.findOneAndUpdate(
        { requestHash: request_hash },
        {
          $set: {
            'feedback.sentimentLabel': feedbackInfo.type === 'positive' ? 'positive' : 
                                       feedbackInfo.type === 'redo' ? 'neutral' : 'negative',
            'feedback.implicitSignals.quickFeedback': action,
            'feedback.collectedAt': new Date(),
          }
        }
      );
    }
    
    logger.info(`Quick feedback: ${subscriber_id} - ${action} for ${request_hash || 'general'}`);
    
    res.json({
      status: 'success',
      message: action === 'redo' ? 'Creating a fresh version! 🔄' : 'Thanks for the feedback! 🙏'
    });
    
  } catch (error) {
    logger.error('Failed to process quick feedback:', error);
    res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to process feedback'
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

// Legacy exports
export { submitFeedbackHandler, getFeedbackStatsHandler } from './feedback';
