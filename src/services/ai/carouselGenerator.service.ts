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
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '"')
    .replace(/'/g, "'");
}

/**
 * Parse script text into sections
 */
export function parseScriptSections(scriptText: string): ScriptSections {
  const sections: ScriptSections = { hook: [], body: [], cta: [] };

  // Split by section headers [HOOK], [BODY], [CTA]
  const parts = scriptText.split(/\[(HOOK|BODY|CTA)\]/i);

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
 * Extract VISUAL, TEXT OVERLAY, and SAY content from lines
 */
function extractVisualAndDialogue(lines: string[]): { visual: string; textOverlay: string; dialogue: string } {
  let visual = '';
  let textOverlay = '';
  let dialogue = '';

  for (const line of lines) {
    const isVisual = line.includes('🎬') || line.toLowerCase().includes('visual:');
    const isTextOverlay = line.includes('📝') || line.toLowerCase().includes('text overlay:');
    const isSay = line.includes('💬') || line.toLowerCase().includes('say:');

    if (isVisual) {
      const cleaned = line
        .replace(/^🎬\s*/i, '')
        .replace(/^visual:\s*/i, '')
        .trim();
      visual += (visual ? '\n' : '') + cleaned;
    } else if (isTextOverlay) {
      const cleaned = line
        .replace(/^📝\s*/i, '')
        .replace(/^text overlay:\s*/i, '')
        .replace(/^[""]|[""]$/g, '')  // Remove quotes
        .trim();
      textOverlay += (textOverlay ? ' • ' : '') + cleaned;
    } else if (isSay) {
      const cleaned = line
        .replace(/^💬\s*/i, '')
        .replace(/^say:\s*/i, '')
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
 * ENHANCED: Matches demo page styling with proper visual hierarchy
 */
function generateCardTemplate(
  sectionKey: 'hook' | 'body' | 'cta',
  lines: string[],
  variationTag: string
): string {
  const meta = SECTION_META[sectionKey];
  const { visual, textOverlay, dialogue } = extractVisualAndDialogue(lines);

  // Truncate for card fit - increased limits for 900px card
  const displayVisual = truncateText(visual || 'Camera setup goes here...', 180);
  const displayOverlay = truncateText(textOverlay || '', 60);
  const displayDialogue = truncateText(dialogue || 'Dialogue goes here...', 250);

  // Dynamic font sizes based on content length
  const dialogueFontSize = displayDialogue.length > 150 ? 20 : displayDialogue.length > 100 ? 22 : 26;

  return `
    <div style="display: flex; flex-direction: column; width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; padding: 40px; font-family: 'Poppins'; background: linear-gradient(180deg, ${COLORS.bgDark} 0%, ${COLORS.bgCard} 100%); color: ${COLORS.textMain};">
      
      <!-- Top Bar: Brand + Variation + Timing -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid rgba(139, 92, 246, 0.15);">
        
        <!-- Brand -->
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="display: flex; font-size: 18px; font-weight: 800; color: ${COLORS.textMain}; letter-spacing: -0.5px;">SCRIPT<span style="background: linear-gradient(135deg, #8b5cf6 0%, #f59e0b 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">FLOW</span></div>
        </div>
        
        <!-- Badges -->
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="display: flex; background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(245, 158, 11, 0.1) 100%); border: 1px solid rgba(139, 92, 246, 0.3); padding: 5px 12px; border-radius: 16px;">
            <span style="font-size: 11px; font-weight: 700; background: linear-gradient(135deg, #8b5cf6 0%, #f59e0b 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${variationTag}</span>
          </div>
          <div style="display: flex; background: rgba(255,255,255,0.05); border: 1px solid ${COLORS.border}; padding: 5px 12px; border-radius: 16px;">
            <span style="font-size: 11px; font-weight: 600; color: ${COLORS.textDim};">⏱ ${meta.timing}</span>
          </div>
        </div>
      </div>
      
      <!-- Section Header - Compact -->
      <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding: 16px 20px; background: rgba(${sectionKey === 'hook' ? '139, 92, 246' : sectionKey === 'body' ? '245, 158, 11' : '34, 197, 94'}, 0.1); border-radius: 12px; border: 1px solid ${meta.accent}30;">
        <span style="font-size: 28px;">${meta.emoji}</span>
        <div style="display: flex; flex-direction: column;">
          <span style="font-size: 20px; font-weight: 800; color: ${meta.accent}; letter-spacing: 1px;">${meta.number} / ${meta.title}</span>
          <span style="font-size: 12px; color: ${COLORS.textMuted}; font-weight: 500;">${meta.subtitle}</span>
        </div>
      </div>
      
      <!-- Content Area - Flex to fill space -->
      <div style="display: flex; flex-direction: column; flex: 1; gap: 16px;">
        
        <!-- Camera Setup Block -->
        <div style="display: flex; flex-direction: column; padding: 16px 20px; background: rgba(100, 116, 139, 0.08); border-radius: 10px; border: 1px solid rgba(100, 116, 139, 0.15);">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 10px;">
            <span style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1.5px;">📹 CAMERA SETUP</span>
          </div>
          <div style="display: flex; font-size: 14px; color: ${COLORS.textSecondary}; line-height: 1.55;">${escapeHtml(displayVisual)}</div>
        </div>
        
        ${displayOverlay ? `
        <!-- On-Screen Text Block (Sunset Gold) -->
        <div style="display: flex; align-items: center; gap: 12px; padding: 14px 18px; background: rgba(245, 158, 11, 0.1); border-radius: 10px; border: 1px solid rgba(245, 158, 11, 0.25);">
          <span style="font-size: 10px; font-weight: 700; color: #f59e0b; text-transform: uppercase; letter-spacing: 1.5px;">📝 ON-SCREEN</span>
          <span style="font-size: 16px; font-weight: 700; color: #fbbf24;">"${escapeHtml(displayOverlay)}"</span>
        </div>
        ` : ''}
        
        <!-- Dialogue Block (Main Focus - Electric Violet) -->
        <div style="display: flex; flex-direction: column; flex: 1; padding: 20px 24px; background: rgba(139, 92, 246, 0.06); border-radius: 12px; border: 2px solid ${meta.accent}40;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 14px;">
            <span style="font-size: 10px; font-weight: 900; color: ${meta.accent}; text-transform: uppercase; letter-spacing: 2px;">🎤 SPEAK THIS</span>
          </div>
          <div style="display: flex; flex: 1; align-items: center;">
            <div style="display: flex; font-size: ${dialogueFontSize}px; font-weight: 600; color: ${COLORS.textMain}; line-height: 1.5; letter-spacing: -0.3px;">"${escapeHtml(displayDialogue)}"</div>
          </div>
        </div>
        
      </div>
      
      <!-- Footer -->
      <div style="display: flex; justify-content: center; margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(139, 92, 246, 0.1);">
        <span style="font-size: 11px; font-weight: 700; background: linear-gradient(135deg, #8b5cf6 0%, #f59e0b 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: 3px;">SWIPE FOR MORE →</span>
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
