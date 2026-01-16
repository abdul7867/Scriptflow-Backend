#!/usr/bin/env npx ts-node
/**
 * Export Training Data Script
 * 
 * Usage:
 *   npx ts-node scripts/export-training-data.ts --min-quality=60 --limit=1000
 * 
 * Options:
 *   --min-quality  Minimum quality score (0-100), default: 60
 *   --limit        Maximum records to export, default: unlimited
 *   --output       Output file path, default: ./training-data.jsonl
 *   --format       Export format: jsonl or conversational, default: jsonl
 */

import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/db';
import { mlExportService } from '../src/services/ai/mlExport.service';
import path from 'path';

async function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const options: Record<string, string> = {};

    for (const arg of args) {
        const match = arg.match(/^--(\w+)(?:=(.+))?$/);
        if (match) {
            options[match[1]] = match[2] || 'true';
        }
    }

    const minQuality = parseInt(options['min-quality'] || '60', 10);
    const limit = options['limit'] ? parseInt(options['limit'], 10) : undefined;
    const output = options['output'] || './training-data.jsonl';
    const format = (options['format'] || 'jsonl') as 'jsonl' | 'conversational';

    console.log('📊 ML Training Data Export');
    console.log('========================');
    console.log(`Min Quality Score: ${minQuality}`);
    console.log(`Limit: ${limit || 'unlimited'}`);
    console.log(`Output: ${output}`);
    console.log(`Format: ${format}`);
    console.log('');

    try {
        // Connect to database
        console.log('📡 Connecting to MongoDB...');
        await connectDB();

        // Get stats first
        console.log('📈 Getting export statistics...');
        const stats = await mlExportService.getExportStats();
        console.log(`  Total records: ${stats.totalRecords}`);
        console.log(`  Exportable (quality >= ${minQuality}): ${stats.exportableRecords}`);
        console.log(`  Already exported: ${stats.alreadyExported}`);
        console.log(`  Avg quality score: ${stats.avgQualityScore.toFixed(1)}`);
        console.log('');

        // Export data
        console.log('📝 Exporting training data...');
        const outputPath = path.resolve(output);
        const count = await mlExportService.exportToJSONL(outputPath, {
            minQualityScore: minQuality,
            limit,
            format,
            onlyNew: true,
            markExported: true,
        });

        console.log('');
        console.log(`✅ Export complete!`);
        console.log(`   Records exported: ${count}`);
        console.log(`   Output file: ${outputPath}`);

    } catch (error) {
        console.error('❌ Export failed:', error);
        process.exit(1);
    } finally {
        await disconnectDB();
    }
}

main();
