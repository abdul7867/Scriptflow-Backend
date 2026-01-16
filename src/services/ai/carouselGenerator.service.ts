/**
 * Carousel Generator - Generates 3-card carousel for Instagram delivery
 * 
 * ScriptFlow 2.0 Premium Output
 * 
 * Each card is 900x900 (ManyChat Gallery optimal) containing:
 * - Card 1: HOOK section with 0-3 sec timing
 * - Card 2: BODY section with 3-15 sec timing
 * - Card 3: CTA section with 15-20 sec timing
 * 
 * Design features:
 * - Large readable text for mobile viewing
 * - Variation badge (v1, v2, v3...)
 * - Timing indicators
 * - Visual + Dialogue split layout
 */

import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { html } from 'satori-html';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { getVariationTag } from '../../utils/hash';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ScriptSections {
  hook: string[];
  body: string[];
  cta: string[];
}

export interface CarouselImages {
  hookCard: string;      // URL for hook card image
  bodyCard: string;      // URL for body card image
  ctaCard: string;       // URL for CTA card image
  combined?: string;     // URL for combined single image (fallback)
}

export interface CarouselConfig {
  variationIndex: number;
  showTimings: boolean;
  theme: 'dark' | 'light';
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Card dimensions - ManyChat Gallery optimal 1:1 ratio (reduces memory) */
const CARD_WIDTH = 900;
const CARD_HEIGHT = 900;

/** Load fonts (same as imageGenerator) */
let fontDataBold: Buffer;
let fontDataSemiBold: Buffer;
let fontDataRegular: Buffer;

try {
  fontDataBold = fs.readFileSync(path.join(process.cwd(), 'fonts', 'Poppins-Bold.ttf'));
  fontDataSemiBold = fs.readFileSync(path.join(process.cwd(), 'fonts', 'Poppins-SemiBold.ttf'));
  fontDataRegular = fs.readFileSync(path.join(process.cwd(), 'fonts', 'Poppins-Regular.ttf'));
} catch (error) {
  logger.warn('Fonts not loaded - carousel generation will fail until fonts are available');
}

/** Color palette matching Sunset Gold + Electric Violet theme */
const COLORS = {
  // Backgrounds
  bgDark: '#0a0a0c',
  bgCard: '#0f0f12',
  bgSection: 'rgba(15, 15, 18, 0.9)',

  // Text
  textMain: '#fafafa',
  textSecondary: '#a5a5b0',
  textDim: '#e4e4e7',
  textMuted: '#6b6b7a',

  // Primary Accent - Electric Violet
  accent: '#8b5cf6',
  accentBg: 'rgba(139, 92, 246, 0.15)',
  accentBorder: 'rgba(139, 92, 246, 0.4)',
  accentGlow: 'rgba(139, 92, 246, 0.5)',

  // Section-specific accents (matching demo)
  hookAccent: '#8b5cf6',     // Electric Violet - primary
  bodyAccent: '#f59e0b',     // Sunset Gold - secondary  
  ctaAccent: '#22c55e',      // Green - success

  // Content type colors
  cameraColor: '#64748b',    // Slate
  overlayColor: '#f59e0b',   // Sunset Gold
  dialogueColor: '#a78bfa',  // Light Violet

  // Borders
  border: 'rgba(139, 92, 246, 0.1)',
  borderStrong: 'rgba(139, 92, 246, 0.15)',
};

/** Section metadata */
const SECTION_META = {
  hook: {
    number: '01',
    title: 'HOOK',
    emoji: '🎬',
    timing: '0-3 sec',
    subtitle: 'Opening pattern interrupt',
    accent: COLORS.hookAccent,
  },
  body: {
    number: '02',
    title: 'BODY',
    emoji: '📝',
    timing: '3-15 sec',
    subtitle: 'Main content delivery',
    accent: COLORS.bodyAccent,
  },
  cta: {
    number: '03',
    title: 'CTA',
    emoji: '🎯',
    timing: '15-20 sec',
    subtitle: 'Call to action',
    accent: COLORS.ctaAccent,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Escape HTML special characters and sanitize text for safe rendering
 */
function escapeHtml(text: string): string {
  return text
    // Basic HTML entities
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

    // Smart quotes and apostrophes (convert to straight quotes)
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')  // Smart double quotes → "
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")  // Smart single quotes → '

    // Em/En dashes → regular dash
    .replace(/[\u2013\u2014]/g, '-')

    // Ellipsis
    .replace(/\u2026/g, '...')

    // Remove any remaining problematic Unicode characters
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')  // Control characters

    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse script text into sections
 * Handles multiple formats:
 * - [HOOK], [BODY], [CTA]
 * - 🎬 [HOOK (0-3s)], 📝 [BODY (3-15s)], 🚀 [CTA (15-20s)]
 */
export function parseScriptSections(scriptText: string): ScriptSections {
  const sections: ScriptSections = { hook: [], body: [], cta: [] };

  // More flexible regex to handle emoji prefixes and timing info
  // Matches: [HOOK], [HOOK (0-3s)], 🎬 [HOOK (0-3s)], etc.
  const parts = scriptText.split(/(?:🎬|📝|🚀)?\s*\[(HOOK|BODY|CTA)(?:\s*\([^)]*\))?\]/i);

  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i]?.toUpperCase();
    const content = parts[i + 1]?.trim() || '';

    const lines = content.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (header === 'HOOK') sections.hook = lines;
    else if (header === 'BODY') sections.body = lines;
    else if (header === 'CTA') sections.cta = lines;
  }

  return sections;
}

/**
 * Extract VISUAL, TEXT OVERLAY, and DIALOGUE content from lines
 * Handles multiple formats:
 * - Visual:, 🎬, Camera:
 * - On-Screen:, Text Overlay:, 📝
 * - Dialogue:, Say:, 💬
 */
function extractVisualAndDialogue(lines: string[]): { visual: string; textOverlay: string; dialogue: string } {
  let visual = '';
  let textOverlay = '';
  let dialogue = '';

  for (const line of lines) {
    const lowerLine = line.toLowerCase();

    // Check for visual/camera content
    const isVisual = line.includes('🎬') ||
      lowerLine.includes('visual:') ||
      lowerLine.includes('camera:');

    // Check for on-screen/text overlay content
    const isTextOverlay = line.includes('📝') ||
      lowerLine.includes('text overlay:') ||
      lowerLine.includes('on-screen:');

    // Check for dialogue/say content
    const isDialogue = line.includes('💬') ||
      lowerLine.includes('say:') ||
      lowerLine.includes('dialogue:');

    if (isVisual) {
      const cleaned = line
        .replace(/^🎬\s*/i, '')
        .replace(/^visual:\s*/i, '')
        .replace(/^camera:\s*/i, '')
        .trim();
      visual += (visual ? '\n' : '') + cleaned;
    } else if (isTextOverlay) {
      const cleaned = line
        .replace(/^📝\s*/i, '')
        .replace(/^text overlay:\s*/i, '')
        .replace(/^on-screen:\s*/i, '')
        .replace(/^[""]|[""]$/g, '')  // Remove quotes
        .trim();
      textOverlay += (textOverlay ? ' • ' : '') + cleaned;
    } else if (isDialogue) {
      const cleaned = line
        .replace(/^💬\s*/i, '')
        .replace(/^say:\s*/i, '')
        .replace(/^dialogue:\s*/i, '')
        .replace(/^[""]|[""]$/g, '')  // Remove quotes
        .trim();
      dialogue += (dialogue ? '\n' : '') + cleaned;
    }
  }

  return { visual, textOverlay, dialogue };
}

/**
 * Truncate text to fit in card while keeping it readable
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Generate HTML template for a single section card
 * MINIMALIST DESIGN: Clean, uncluttered, stylish, Instagram-optimized
 */
function generateCardTemplate(
  sectionKey: 'hook' | 'body' | 'cta',
  lines: string[],
  variationTag: string
): string {
  const meta = SECTION_META[sectionKey];
  const { visual, textOverlay, dialogue } = extractVisualAndDialogue(lines);

  // Smart truncation - handles all content lengths
  const displayVisual = truncateText(visual || 'Camera setup...', 120);
  const displayOverlay = truncateText(textOverlay || '', 70);
  const displayDialogue = truncateText(dialogue || 'Dialogue goes here...', 180);

  // Dynamic font sizing - scales for all content lengths
  const dialogueFontSize = displayDialogue.length > 130 ? 30 :
    displayDialogue.length > 100 ? 36 :
      displayDialogue.length > 60 ? 42 : 48;

  return `
    <div style="display: flex; flex-direction: column; width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; padding: 48px; font-family: 'Poppins'; background: ${COLORS.bgDark}; color: ${COLORS.textMain};">
      
      <!-- Minimal Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px;">
        <div style="font-size: 14px; font-weight: 700; color: ${COLORS.textSecondary}; letter-spacing: 2px;">SCRIPTFLOW</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 11px; font-weight: 600; color: ${meta.accent};">${variationTag}</span>
          <span style="font-size: 11px; color: ${COLORS.textMuted};">•</span>
          <span style="font-size: 11px; color: ${COLORS.textMuted};">${meta.timing}</span>
        </div>
      </div>
      
      <!-- Section Title - Clean -->
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 40px;">
        <span style="font-size: 32px;">${meta.emoji}</span>
        <span style="font-size: 24px; font-weight: 800; color: ${meta.accent}; letter-spacing: 1px;">${meta.title}</span>
      </div>
      
      <!-- HERO: Main Dialogue -->
      <div style="display: flex; flex: 1; align-items: center; justify-content: center; margin-bottom: 32px;">
        <div style="font-size: ${dialogueFontSize}px; font-weight: 700; color: ${COLORS.textMain}; line-height: 1.3; letter-spacing: -0.8px; text-align: center;">"${escapeHtml(displayDialogue)}"</div>
      </div>
      
      <!-- Supporting Info - Horizontal Inline Layout -->
      <div style="display: flex; flex-direction: column; gap: 10px;">
        
        ${displayOverlay ? `
        <!-- On-Screen Text - Inline Layout -->
        <div style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: rgba(245, 158, 11, 0.08); border-left: 4px solid ${COLORS.bodyAccent}; border-radius: 4px;">
          <span style="font-size: 10px; font-weight: 700; color: ${COLORS.bodyAccent}; text-transform: uppercase; letter-spacing: 1px; white-space: nowrap;">ON-SCREEN</span>
          <span style="font-size: 16px; font-weight: 600; color: #fbbf24;">"${escapeHtml(displayOverlay)}"</span>
        </div>
        ` : ''}
        
        <!-- Camera Setup - Inline Layout -->
        <div style="display: flex; align-items: flex-start; gap: 12px; padding: 10px 14px; background: rgba(100, 116, 139, 0.05); border-left: 4px solid ${COLORS.cameraColor}; border-radius: 4px;">
          <span style="font-size: 10px; font-weight: 700; color: ${COLORS.cameraColor}; text-transform: uppercase; letter-spacing: 1px; white-space: nowrap;">CAMERA</span>
          <span style="font-size: 13px; color: ${COLORS.textSecondary}; line-height: 1.5;">${escapeHtml(displayVisual)}</span>
        </div>
        
      </div>
      
    </div>
  `;
}


/**
 * Render HTML template to PNG buffer
 */
async function renderToPng(htmlTemplate: string): Promise<Buffer> {
  const template = html(htmlTemplate);

  const svg = await satori(template as any, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: [
      {
        name: 'Poppins',
        data: fontDataRegular,
        weight: 400,
        style: 'normal',
      },
      {
        name: 'Poppins',
        data: fontDataSemiBold,
        weight: 600,
        style: 'normal',
      },
      {
        name: 'Poppins',
        data: fontDataBold,
        weight: 700,
        style: 'normal',
      },
    ],
  });

  const resvg = new Resvg(svg, {
    background: 'rgba(0,0,0,0)',
    fitTo: {
      mode: 'width',
      value: CARD_WIDTH,
    },
  });

  const pngData = resvg.render();
  return pngData.asPng();
}

/**
 * Upload PNG buffer to storage (S3 or ImgBB)
 */
async function uploadImage(pngBuffer: Buffer, filename: string): Promise<string> {
  if (config.IMAGE_PROVIDER === 's3') {
    const { uploadToS3 } = await import('../external/s3.service');
    return uploadToS3(pngBuffer, filename);
  } else {
    // ImgBB fallback
    const formData = new FormData();
    formData.append('image', pngBuffer, { filename });

    const response = await axios.post(
      `https://api.imgbb.com/1/upload?key=${config.IMGBB_API_KEY}`,
      formData,
      {
        headers: formData.getHeaders(),
        timeout: 30000,
      }
    );

    if (response.data?.data?.url) {
      return response.data.data.url;
    }
    throw new Error('ImgBB upload failed');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate carousel images for all 3 sections
 * 
 * @param scriptText - Full script text with [HOOK], [BODY], [CTA] sections
 * @param variationIndex - Which variation this is (0, 1, 2...)
 * @returns CarouselImages with URLs for each card
 * 
 * @example
 * const images = await generateCarouselImages(scriptText, 0);
 * // images.hookCard = "https://..."
 * // images.bodyCard = "https://..."
 * // images.ctaCard = "https://..."
 */
export async function generateCarouselImages(
  scriptText: string,
  variationIndex: number = 0
): Promise<CarouselImages> {
  const startTime = Date.now();
  const variationTag = getVariationTag(variationIndex);

  logger.info('Generating carousel images', { variationIndex, variationTag });

  try {
    // Parse script into sections
    const sections = parseScriptSections(scriptText);

    // Generate unique filenames with timestamp
    const timestamp = Date.now();
    const prefix = `carousel_${timestamp}_${variationTag}`;

    // Generate all 3 cards in parallel
    const [hookBuffer, bodyBuffer, ctaBuffer] = await Promise.all([
      renderToPng(generateCardTemplate('hook', sections.hook, variationTag)),
      renderToPng(generateCardTemplate('body', sections.body, variationTag)),
      renderToPng(generateCardTemplate('cta', sections.cta, variationTag)),
    ]);

    const renderTime = Date.now() - startTime;
    logger.info(`Carousel cards rendered in ${renderTime}ms`);

    // MEMORY OPTIMIZATION: Upload sequentially to avoid holding all 3 buffers
    // Each buffer can be ~300-400KB, so sequential upload reduces peak memory by ~600KB
    const hookUrl = await uploadImage(hookBuffer, `${prefix}_hook.png`);
    // @ts-ignore - Allow nullifying for GC
    let hook = null; // Allow GC to collect hookBuffer

    const bodyUrl = await uploadImage(bodyBuffer, `${prefix}_body.png`);
    // @ts-ignore - Allow nullifying for GC
    let body = null; // Allow GC to collect bodyBuffer

    const ctaUrl = await uploadImage(ctaBuffer, `${prefix}_cta.png`);
    // @ts-ignore - Allow nullifying for GC
    let cta = null; // Allow GC to collect ctaBuffer

    const totalTime = Date.now() - startTime;
    logger.info(`Carousel images generated and uploaded in ${totalTime}ms`, {
      hookUrl: hookUrl.substring(0, 50) + '...',
      bodyUrl: bodyUrl.substring(0, 50) + '...',
      ctaUrl: ctaUrl.substring(0, 50) + '...',
    });

    // MEMORY OPTIMIZATION: Hint GC after heavy image processing
    if (global.gc) {
      setImmediate(() => {
        try { global.gc!(); } catch (e) { /* ignore */ }
      });
    }

    return {
      hookCard: hookUrl,
      bodyCard: bodyUrl,
      ctaCard: ctaUrl,
    };

  } catch (error: any) {
    logger.error('Failed to generate carousel images', { error: error.message });
    throw error;
  }
}

/**
 * Generate a single section card image
 * Useful for partial regeneration
 */
export async function generateSectionImage(
  sectionKey: 'hook' | 'body' | 'cta',
  lines: string[],
  variationIndex: number = 0
): Promise<string> {
  const variationTag = getVariationTag(variationIndex);
  const timestamp = Date.now();

  const buffer = await renderToPng(generateCardTemplate(sectionKey, lines, variationTag));
  return uploadImage(buffer, `section_${sectionKey}_${timestamp}.png`);
}

/**
 * Check if carousel generation is available
 * (fonts loaded, config valid)
 */
export function isCarouselAvailable(): boolean {
  return !!(fontDataBold && fontDataSemiBold && fontDataRegular);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  generateCarouselImages,
  generateSectionImage,
  parseScriptSections,
  isCarouselAvailable,
};
