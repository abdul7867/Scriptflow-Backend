import { Request, Response } from 'express';
import { feedbackSchema } from '../validators/requestValidator';
import { DatasetEntry, computeQualityScore } from '../db/models/Dataset';
import { logger } from '../utils/logger';

/**
 * Feedback Collection API
 * 
 * Collects user feedback for ML training:
 * - Overall ratings
 * - Section-level feedback (which parts were regenerated)
 * - Free text feedback
 * - Video performance metrics (if user provides later)
 */
export const submitFeedbackHandler = async (req: Request, res: Response) => {
  try {
    // Validate request
    const parseResult = feedbackSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_INPUT',
        message: parseResult.error.issues.map(e => e.message).join(', ')
      });
    }

    const { 
      request_hash,
      overall_rating,
      section_feedback,
      feedback_text,
      video_performance
    } = parseResult.data;

    // Find the dataset entry
    const entry = await DatasetEntry.findOne({ 
      'input.requestHash': request_hash 
    });

    if (!entry) {
      return res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Script not found. Feedback can only be submitted for existing scripts.'
      });
    }

    // Update feedback fields
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
          regenerationReason: section_feedback.hook.regeneration_reason
        };
        if (section_feedback.hook.regeneration_reason) {
          entry.feedback.wasAccepted = false;
        }
      }
      
      if (section_feedback.body) {
        entry.feedback.sectionFeedback.body = {
          rating: section_feedback.body.rating,
          wasRegenerated: !!section_feedback.body.regeneration_reason,
          regenerationReason: section_feedback.body.regeneration_reason
        };
        if (section_feedback.body.regeneration_reason) {
          entry.feedback.wasAccepted = false;
        }
      }
      
      if (section_feedback.cta) {
        entry.feedback.sectionFeedback.cta = {
          rating: section_feedback.cta.rating,
          wasRegenerated: !!section_feedback.cta.regeneration_reason,
          regenerationReason: section_feedback.cta.regeneration_reason
        };
        if (section_feedback.cta.regeneration_reason) {
          entry.feedback.wasAccepted = false;
        }
      }
    }

    if (video_performance) {
      entry.feedback.videoPerformance = {
        views: video_performance.views,
        likes: video_performance.likes,
        comments: video_performance.comments,
        shares: video_performance.shares,
        reportedAt: new Date()
      };
    }

    // Recompute quality score based on new feedback
    entry.training.qualityScore = computeQualityScore(entry);

    await entry.save();

    logger.info(`Feedback received for ${request_hash}: rating=${overall_rating}, quality=${entry.training.qualityScore}`);

    res.json({ 
      status: 'success',
      message: 'Thank you for your feedback!',
      qualityScore: entry.training.qualityScore
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

/**
 * Get feedback stats (for admin dashboard)
 */
export const getFeedbackStatsHandler = async (req: Request, res: Response) => {
  try {
    const [
      totalEntries,
      ratedEntries,
      avgRating,
      regeneratedCount,
      highQualityCount
    ] = await Promise.all([
      DatasetEntry.countDocuments(),
      DatasetEntry.countDocuments({ 'feedback.overallRating': { $exists: true } }),
      DatasetEntry.aggregate([
        { $match: { 'feedback.overallRating': { $exists: true } } },
        { $group: { _id: null, avg: { $avg: '$feedback.overallRating' } } }
      ]),
      DatasetEntry.countDocuments({ 'feedback.wasAccepted': false }),
      DatasetEntry.countDocuments({ 'training.qualityScore': { $gte: 70 } })
    ]);

    res.json({
      status: 'success',
      stats: {
        totalEntries,
        ratedEntries,
        averageRating: avgRating[0]?.avg?.toFixed(2) || 'N/A',
        regeneratedCount,
        highQualityCount,
        qualityRate: totalEntries > 0 
          ? ((highQualityCount / totalEntries) * 100).toFixed(1) + '%' 
          : 'N/A'
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
