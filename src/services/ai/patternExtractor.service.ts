/**
 * Pattern DNA Extractor Service
 * 
 * Extracts structural patterns from video analysis and scripts to enable
 * pattern-preserving remix transformations.
 * 
 * @author ScriptFlow Team
 * @version 1.0.0
 */

import { VideoAnalysis } from '../video/videoAnalyzer.service';
import { logger } from '../../utils/logger';

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN DNA TYPE
// ═══════════════════════════════════════════════════════════════════════════

export interface PatternDNA {
    hookArchetype: string;
    openingWords: string;
    pacing: 'fast' | 'medium' | 'dramatic';
    visualStyle: 'minimal' | 'dynamic' | 'instructional';
    sentenceLengthPattern: number[];
    toneMarkers: string[];
    extractedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract pacing classification from sentence lengths
 */
function classifyPacing(sentenceLengths: number[]): 'fast' | 'medium' | 'dramatic' {
    if (sentenceLengths.length === 0) return 'medium';

    const avgLength = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
    const variance = sentenceLengths.reduce((acc, len) => acc + Math.pow(len - avgLength, 2), 0) / sentenceLengths.length;

    // Fast pacing: short sentences, low variance (punchy, consistent)
    if (avgLength < 12 && variance < 20) return 'fast';

    // Dramatic pacing: high variance (long pauses, dramatic builds)
    if (variance > 50) return 'dramatic';

    // Medium: everything else
    return 'medium';
}

/**
 * Extract visual style from visual cues
 */
function classifyVisualStyle(visualCues: string[]): 'minimal' | 'dynamic' | 'instructional' {
    const cuesText = visualCues.join(' ').toLowerCase();

    // Dynamic: multiple angles, movements, gestures
    const dynamicKeywords = ['angle', 'movement', 'gesture', 'zoom', 'transition', 'b-roll', 'cutaway'];
    const dynamicCount = dynamicKeywords.filter(k => cuesText.includes(k)).length;

    // Instructional: screen recording, demonstration, step-by-step
    const instructionalKeywords = ['screen', 'demonstration', 'step', 'tutorial', 'showing', 'pointing'];
    const instructionalCount = instructionalKeywords.filter(k => cuesText.includes(k)).length;

    if (dynamicCount >= 3) return 'dynamic';
    if (instructionalCount >= 2) return 'instructional';
    return 'minimal';
}

/**
 * Extract tone markers (connector words/phrases) from script
 */
function extractToneMarkers(scriptText: string): string[] {
    const commonMarkers = [
        'look', 'here\'s the thing', 'real talk', 'listen', 'honestly',
        'but here\'s the deal', 'the truth is', 'let me be real',
        'no cap', 'straight up', 'fact is', 'here\'s what',
    ];

    const normalizedScript = scriptText.toLowerCase();
    const foundMarkers: string[] = [];

    for (const marker of commonMarkers) {
        if (normalizedScript.includes(marker)) {
            foundMarkers.push(marker);
        }
    }

    return foundMarkers.slice(0, 3); // Keep top 3
}

/**
 * Parse script to extract sentence lengths
 */
function extractSentenceLengths(scriptText: string): number[] {
    // Extract only the SAY: lines (actual spoken content)
    const sayLines = scriptText
        .split('\n')
        .filter(line => line.trim().startsWith('SAY:'))
        .map(line => line.replace('SAY:', '').trim());

    if (sayLines.length === 0) {
        // Fallback: use all text
        return scriptText
            .split(/[.!?]+/)
            .map(s => s.trim().split(/\s+/).length)
            .filter(len => len > 2); // Filter out very short fragments
    }

    // Split SAY lines into sentences and count words
    const sentenceLengths: number[] = [];

    for (const line of sayLines) {
        const sentences = line.split(/[.!?]+/);
        for (const sentence of sentences) {
            const words = sentence.trim().split(/\s+/).filter(w => w.length > 0);
            if (words.length > 2) { // Ignore very short fragments
                sentenceLengths.push(words.length);
            }
        }
    }

    return sentenceLengths;
}

/**
 * Extract opening words from hook section
 */
function extractOpeningWords(scriptText: string): string {
    // Find the HOOK section
    const hookMatch = scriptText.match(/\[HOOK\]([\s\S]*?)(?:\[BODY|\[BODY - PART|$)/);

    if (!hookMatch) {
        // Fallback: use first SAY: line
        const firstSay = scriptText.split('\n').find(line => line.trim().startsWith('SAY:'));
        if (firstSay) {
            const words = firstSay.replace('SAY:', '').trim().split(/\s+/).slice(0, 10);
            return words.join(' ');
        }
        return '';
    }

    const hookContent = hookMatch[1];

    // Extract first SAY: line from hook
    const firstSay = hookContent.split('\n').find(line => line.trim().startsWith('SAY:'));

    if (!firstSay) return '';

    // Get first 10 words
    const words = firstSay.replace('SAY:', '').trim().split(/\s+/).slice(0, 10);
    return words.join(' ');
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXTRACTION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract Pattern DNA from video analysis and script
 * 
 * @param analysis - Video analysis from ReelDNA cache
 * @param scriptText - Generated script text
 * @returns Pattern DNA object or null if extraction fails
 */
export function extractPatternDNA(
    analysis: VideoAnalysis | null,
    scriptText: string
): PatternDNA | null {
    try {
        // Extract structural patterns from script
        const sentenceLengths = extractSentenceLengths(scriptText);
        const openingWords = extractOpeningWords(scriptText);
        const toneMarkers = extractToneMarkers(scriptText);

        // Use analysis data if available, otherwise infer from script
        const hookArchetype = analysis?.hookType || 'Pattern Interrupt';
        const visualCues = analysis?.visualCues || [];

        const pacing = classifyPacing(sentenceLengths);
        const visualStyle = classifyVisualStyle(visualCues);

        const patternDNA: PatternDNA = {
            hookArchetype,
            openingWords,
            pacing,
            visualStyle,
            sentenceLengthPattern: sentenceLengths.slice(0, 10), // Keep first 10 for pattern
            toneMarkers,
            extractedAt: new Date(),
        };

        logger.info('[PatternDNA] Extracted pattern DNA', {
            hookArchetype,
            pacing,
            visualStyle,
            toneMarkersCount: toneMarkers.length,
            sentenceCount: sentenceLengths.length,
        });

        return patternDNA;
    } catch (error) {
        logger.error('[PatternDNA] Failed to extract pattern DNA', { error });
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN MANDATE BUILDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a pattern preservation mandate for AI prompt
 * 
 * @param dna - Pattern DNA to preserve
 * @param remixType - Type of remix transformation
 * @returns Formatted pattern mandate text
 */
export function buildPatternMandate(dna: PatternDNA, remixType: string): string {
    const pacingDescriptions = {
        fast: 'short, punchy sentences with consistent rhythm',
        medium: 'balanced sentence lengths with natural flow',
        dramatic: 'varied pacing with strategic pauses and builds',
    };

    const visualDescriptions = {
        minimal: 'simple, focused visual direction (talking head, minimal movement)',
        dynamic: 'active visuals with multiple angles, gestures, and transitions',
        instructional: 'demonstration-focused with clear visual cues and steps',
    };

    return `
[PATTERN DNA - PRESERVE THESE ELEMENTS]
═══════════════════════════════════════════════

Hook Pattern: ${dna.hookArchetype}
Opening Style: "${dna.openingWords}"
Pacing: ${dna.pacing.toUpperCase()} (${pacingDescriptions[dna.pacing]})
Visual Style: ${dna.visualStyle.toUpperCase()} (${visualDescriptions[dna.visualStyle]})
${dna.toneMarkers.length > 0 ? `Tone Connectors: ${dna.toneMarkers.map(m => `"${m}"`).join(', ')}` : ''}

CRITICAL RULES FOR ${remixType.toUpperCase()} TRANSFORMATION:
1. MAINTAIN the ${dna.hookArchetype} hook pattern - don't switch to a different archetype
2. PRESERVE the ${dna.pacing} pacing style - ${pacingDescriptions[dna.pacing]}
3. KEEP the ${dna.visualStyle} visual style - ${visualDescriptions[dna.visualStyle]}
${dna.toneMarkers.length > 0 ? `4. USE similar tone connectors - include words like ${dna.toneMarkers.slice(0, 2).map(m => `"${m}"`).join(' or ')}` : ''}

Apply the transformation while preserving these pattern elements.
═══════════════════════════════════════════════
`.trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN VALIDATION (OPTIONAL)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate that a remixed script preserves the original pattern DNA
 * 
 * @param originalDNA - Original pattern DNA
 * @param remixedScript - Remixed script text
 * @returns Validation result with score and details
 */
export function validatePatternPreservation(
    originalDNA: PatternDNA,
    remixedScript: string
): { preserved: boolean; score: number; details: string[] } {
    const details: string[] = [];
    let score = 0;
    const maxScore = 4;

    // Extract pattern from remixed script
    const remixedDNA = extractPatternDNA(null, remixedScript);

    if (!remixedDNA) {
        return { preserved: false, score: 0, details: ['Failed to extract pattern from remix'] };
    }

    // Check pacing preservation
    if (remixedDNA.pacing === originalDNA.pacing) {
        score += 1;
        details.push(`✓ Pacing preserved: ${originalDNA.pacing}`);
    } else {
        details.push(`✗ Pacing changed: ${originalDNA.pacing} → ${remixedDNA.pacing}`);
    }

    // Check visual style preservation
    if (remixedDNA.visualStyle === originalDNA.visualStyle) {
        score += 1;
        details.push(`✓ Visual style preserved: ${originalDNA.visualStyle}`);
    } else {
        details.push(`✗ Visual style changed: ${originalDNA.visualStyle} → ${remixedDNA.visualStyle}`);
    }

    // Check opening words similarity (at least 50% overlap)
    const originalWords = originalDNA.openingWords.toLowerCase().split(/\s+/);
    const remixedWords = remixedDNA.openingWords.toLowerCase().split(/\s+/);
    const overlap = originalWords.filter(w => remixedWords.includes(w)).length;
    const overlapPercent = originalWords.length > 0 ? overlap / originalWords.length : 0;

    if (overlapPercent >= 0.3) {
        score += 1;
        details.push(`✓ Opening pattern similar (${Math.round(overlapPercent * 100)}% overlap)`);
    } else {
        details.push(`✗ Opening pattern changed (${Math.round(overlapPercent * 100)}% overlap)`);
    }

    // Check tone markers preservation
    const sharedMarkers = originalDNA.toneMarkers.filter(m =>
        remixedDNA.toneMarkers.includes(m)
    );

    if (sharedMarkers.length > 0 || originalDNA.toneMarkers.length === 0) {
        score += 1;
        details.push(`✓ Tone markers preserved: ${sharedMarkers.join(', ') || 'N/A'}`);
    } else {
        details.push(`✗ Tone markers lost`);
    }

    const preserved = score >= maxScore * 0.75; // 75% threshold

    logger.info('[PatternDNA] Validation complete', {
        score: `${score}/${maxScore}`,
        preserved,
        details,
    });

    return { preserved, score: score / maxScore, details };
}
