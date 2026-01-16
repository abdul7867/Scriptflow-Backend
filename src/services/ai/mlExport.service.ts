/**
 * ML Data Export Service - Export training data for model fine-tuning
 * 
 * Memory-efficient streaming export for t3.micro environment
 * Outputs JSONL format suitable for Gemini/OpenAI fine-tuning
 * 
 * @see implementation_plan.md - Component 6
 */

import { DatasetEntryV2, IDatasetEntryV2 } from '../../db/models/DatasetV2';
import { logger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface TrainingPair {
    /** Unique ID for this training sample */
    id: string;

    /** Input features for the model */
    input: {
        reelTranscript: string;
        userIdea: string;
        visualCues: string[];
        tone?: string;
        contentType?: string;
    };

    /** Expected output (the generated script) */
    output: {
        fullScript: string;
        sections: {
            hook: string;
            body: string;
            cta: string;
        };
    };

    /** Quality metadata for filtering */
    metadata: {
        qualityScore: number;
        wasAccepted: boolean;
        userRating?: number;
        didCopy: boolean;
        generationTimeMs: number;
    };
}

export interface ExportOptions {
    /** Minimum quality score (0-100) to include */
    minQualityScore?: number;

    /** Maximum number of records to export */
    limit?: number;

    /** Date range filter */
    dateRange?: {
        start: Date;
        end: Date;
    };

    /** Only export records not previously exported */
    onlyNew?: boolean;

    /** Mark records as exported after export */
    markExported?: boolean;

    /** Export format */
    format?: 'jsonl' | 'conversational';
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT SERVICE CLASS
// ═══════════════════════════════════════════════════════════════════════════

class MLExportService {

    /**
     * Stream training data as JSONL (memory-efficient)
     * @param outputPath - Path to write JSONL file
     * @param options - Export options
     * @returns Number of records exported
     */
    async exportToJSONL(outputPath: string, options: ExportOptions = {}): Promise<number> {
        const {
            minQualityScore = 60,
            limit,
            dateRange,
            onlyNew = true,
            markExported = true,
            format = 'jsonl',
        } = options;

        // Build query
        const query: any = {
            'training.qualityScore': { $gte: minQualityScore },
            'output.generatedScript': { $exists: true, $ne: '' },
            'input.transcript': { $exists: true, $ne: '' },
        };

        if (onlyNew) {
            query['training.exportedAt'] = { $exists: false };
        }

        if (dateRange) {
            query.createdAt = {
                $gte: dateRange.start,
                $lte: dateRange.end,
            };
        }

        logger.info('Starting ML data export', {
            outputPath,
            minQualityScore,
            limit,
            onlyNew,
        });

        // Use cursor for memory-efficient streaming
        const cursor = DatasetEntryV2.find(query)
            .sort({ 'training.qualityScore': -1 })
            .limit(limit || 0)
            .cursor();

        const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf8' });
        let exportedCount = 0;
        const exportedIds: string[] = [];

        try {
            for await (const doc of cursor) {
                const trainingPair = format === 'conversational'
                    ? this.toConversationalFormat(doc)
                    : this.toTrainingPair(doc);

                if (trainingPair) {
                    writeStream.write(JSON.stringify(trainingPair) + '\n');
                    exportedCount++;
                    exportedIds.push(doc._id.toString());

                    // Log progress every 100 records
                    if (exportedCount % 100 === 0) {
                        logger.debug(`Exported ${exportedCount} records`);
                    }
                }
            }

            writeStream.end();

            // Mark records as exported
            if (markExported && exportedIds.length > 0) {
                await DatasetEntryV2.updateMany(
                    { _id: { $in: exportedIds } },
                    {
                        $set: {
                            'training.exportedAt': new Date(),
                            'training.includedInTraining': true,
                        }
                    }
                );
            }

            logger.info('ML data export complete', {
                outputPath,
                exportedCount,
                markedAsExported: markExported,
            });

            return exportedCount;

        } catch (error) {
            writeStream.destroy();
            logger.error('ML export failed', { error });
            throw error;
        }
    }

    /**
     * Convert database record to training pair format
     */
    private toTrainingPair(doc: IDatasetEntryV2): TrainingPair | null {
        try {
            // Skip if missing required fields
            if (!doc.input.transcript || !doc.output.generatedScript) {
                return null;
            }

            return {
                id: doc._id.toString(),
                input: {
                    reelTranscript: doc.input.transcript,
                    userIdea: doc.input.userIdea,
                    visualCues: doc.input.visualCues || [],
                    tone: doc.input.detectedTone || doc.input.toneHint,
                    contentType: doc.classification?.contentType,
                },
                output: {
                    fullScript: doc.output.generatedScript,
                    sections: {
                        hook: doc.output.scriptSections?.hook || '',
                        body: doc.output.scriptSections?.body || '',
                        cta: doc.output.scriptSections?.cta || '',
                    },
                },
                metadata: {
                    qualityScore: doc.training?.qualityScore || doc.qualityMetrics?.overallScore || 50,
                    wasAccepted: doc.feedback?.wasAccepted || false,
                    userRating: doc.feedback?.overallRating,
                    didCopy: doc.feedback?.implicit?.didCopy || false,
                    generationTimeMs: doc.generation?.totalTimeMs || 0,
                },
            };
        } catch (error) {
            logger.warn('Failed to convert record to training pair', { id: doc._id, error });
            return null;
        }
    }

    /**
     * Convert to conversational format for chat fine-tuning
     * Format: { messages: [{ role: "user", content: "..." }, { role: "assistant", content: "..." }] }
     */
    private toConversationalFormat(doc: IDatasetEntryV2): object | null {
        try {
            if (!doc.input.transcript || !doc.output.generatedScript) {
                return null;
            }

            const userPrompt = this.buildUserPrompt(doc);
            const assistantResponse = doc.output.generatedScript;

            return {
                messages: [
                    { role: 'user', content: userPrompt },
                    { role: 'assistant', content: assistantResponse },
                ],
                metadata: {
                    id: doc._id.toString(),
                    qualityScore: doc.training?.qualityScore || 50,
                },
            };
        } catch (error) {
            logger.warn('Failed to convert to conversational format', { id: doc._id, error });
            return null;
        }
    }

    /**
     * Build user prompt from input features
     */
    private buildUserPrompt(doc: IDatasetEntryV2): string {
        const parts: string[] = [];

        parts.push(`Reel Transcript: "${doc.input.transcript}"`);

        if (doc.input.userIdea && !doc.input.isDefaultIdea) {
            parts.push(`User's Idea: "${doc.input.userIdea}"`);
        }

        if (doc.input.visualCues && doc.input.visualCues.length > 0) {
            parts.push(`Visual Elements: ${doc.input.visualCues.join(', ')}`);
        }

        if (doc.input.toneHint) {
            parts.push(`Desired Tone: ${doc.input.toneHint}`);
        }

        parts.push('Generate a viral reel script with HOOK, BODY, and CTA sections.');

        return parts.join('\n\n');
    }

    /**
     * Get export statistics
     */
    async getExportStats(): Promise<{
        totalRecords: number;
        exportableRecords: number;
        alreadyExported: number;
        avgQualityScore: number;
    }> {
        const [total, exportable, exported, avgQuality] = await Promise.all([
            DatasetEntryV2.countDocuments(),
            DatasetEntryV2.countDocuments({
                'training.qualityScore': { $gte: 60 },
                'output.generatedScript': { $exists: true, $ne: '' },
                'input.transcript': { $exists: true, $ne: '' },
            }),
            DatasetEntryV2.countDocuments({
                'training.exportedAt': { $exists: true },
            }),
            DatasetEntryV2.aggregate([
                { $match: { 'training.qualityScore': { $exists: true } } },
                { $group: { _id: null, avg: { $avg: '$training.qualityScore' } } },
            ]),
        ]);

        return {
            totalRecords: total,
            exportableRecords: exportable,
            alreadyExported: exported,
            avgQualityScore: avgQuality[0]?.avg || 0,
        };
    }

    /**
     * Stream records for external processing (e.g., Python script)
     * Returns an async iterator for memory-efficient processing
     */
    async *streamForTraining(options: ExportOptions = {}): AsyncGenerator<TrainingPair> {
        const {
            minQualityScore = 60,
            limit,
        } = options;

        const cursor = DatasetEntryV2.find({
            'training.qualityScore': { $gte: minQualityScore },
            'output.generatedScript': { $exists: true, $ne: '' },
            'input.transcript': { $exists: true, $ne: '' },
        })
            .sort({ 'training.qualityScore': -1 })
            .limit(limit || 0)
            .cursor();

        for await (const doc of cursor) {
            const pair = this.toTrainingPair(doc);
            if (pair) {
                yield pair;
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

export const mlExportService = new MLExportService();
export { MLExportService };
export default mlExportService;
