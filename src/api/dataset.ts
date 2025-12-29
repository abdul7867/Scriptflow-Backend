import { Request, Response } from 'express';
import { DatasetEntry } from '../db/models';
import { logger } from '../utils/logger';

/**
 * Export dataset for ML training
 * 
 * Query params:
 * - format: 'json' (default) or 'csv'
 * - validated: 'true' to only get validated entries
 * - limit: number of entries (default 1000)
 * - skip: pagination offset
 */
export const exportDatasetHandler = async (req: Request, res: Response) => {
  try {
    const format = (req.query.format as string) || 'json';
    const validatedOnly = req.query.validated === 'true';
    const limit = Math.min(parseInt(req.query.limit as string) || 1000, 10000);
    const skip = parseInt(req.query.skip as string) || 0;

    // Build query
    const query: any = {};
    if (validatedOnly) {
      query.isValidated = true;
    }

    // Fetch dataset entries
    const entries = await DatasetEntry.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await DatasetEntry.countDocuments(query);

    if (format === 'csv') {
      // Convert to CSV
      const csv = convertToCSV(entries);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=dataset.csv');
      return res.send(csv);
    }

    // JSON format
    res.json({
      status: 'success',
      data: {
        entries,
        pagination: {
          total,
          limit,
          skip,
          hasMore: skip + entries.length < total
        }
      }
    });

  } catch (error) {
    logger.error('Dataset export failed:', error);
    res.status(500).json({
      status: 'error',
      code: 'EXPORT_FAILED',
      message: 'Failed to export dataset'
    });
  }
};

/**
 * Convert dataset entries to CSV format
 */
function convertToCSV(entries: any[]): string {
  if (entries.length === 0) return '';

  // Headers
  const headers = [
    'id',
    'video_url',
    'user_idea',
    'transcript',
    'visual_cues',
    'hook_type',
    'tone',
    'generated_script',
    'script_length',
    'generation_time_ms',
    'user_rating',
    'model_version',
    'created_at'
  ];

  // Build rows
  const rows = entries.map(entry => [
    entry._id,
    escapeCSV(entry.input?.videoUrl || ''),
    escapeCSV(entry.input?.userIdea || ''),
    escapeCSV(entry.input?.transcript || ''),
    escapeCSV((entry.input?.visualCues || []).join('; ')),
    escapeCSV(entry.input?.hookType || ''),
    escapeCSV(entry.input?.tone || ''),
    escapeCSV(entry.output?.generatedScript || ''),
    entry.output?.scriptLengthChars || 0,
    entry.metrics?.generationTimeMs || 0,
    entry.metrics?.userRating || '',
    entry.modelVersion || '',
    entry.createdAt?.toISOString() || ''
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

function escapeCSV(str: string): string {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
