/**
 * Carousel Generator - Generates 3-card carousel for Instagram delivery
 * 
 * ScriptFlow 2.0 Premium Output
 * 
 * Each card is 1080x1080 (Instagram optimal) containing:
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
import { logger } from '../utils/logger';
import { config } from '../config';
import { getVariationTag } from '../utils/hash';

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

/** Card dimensions - Instagram optimal 1:1 ratio */
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1080;

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

/** Color palette matching the main image generator */
const COLORS = {
  // Backgrounds
  bgDark: '#09090b',
  bgCard: '#18181b',
  bgSection: 'rgba(24, 24, 27, 0.8)',
  
  // Text
  textMain: '#fafafa',
  textSecondary: '#d4d4d8',
  textDim: '#a1a1aa',
  textMuted: '#52525b',
  
  // Accent (cyan theme)
  accent: '#22d3ee',
  accentBg: 'rgba(34, 211, 238, 0.15)',
  accentBorder: 'rgba(34, 211, 238, 0.4)',
  accentGlow: 'rgba(34, 211, 238, 0.5)',
  
  // Section-specific accents
  hookAccent: '#22d3ee',     // Cyan
  bodyAccent: '#a78bfa',     // Purple  
  ctaAccent: '#4ade80',      // Green
  
  // Borders
  border: 'rgba(255, 255, 255, 0.1)',
  borderStrong: 'rgba(255, 255, 255, 0.15)',
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
 * Extract VISUAL and SAY content from lines
 */
function extractVisualAndDialogue(lines: string[]): { visual: string; dialogue: string } {
  let visual = '';
  let dialogue = '';
  
  for (const line of lines) {
    const isVisual = line.includes('🎬') || line.toLowerCase().includes('visual:');
    const isSay = line.includes('💬') || line.toLowerCase().includes('say:');
    
    if (isVisual) {
      const cleaned = line
        .replace(/^🎬\s*/i, '')
        .replace(/^visual:\s*/i, '')
        .trim();
      visual += (visual ? '\n' : '') + cleaned;
    } else if (isSay) {
      const cleaned = line
        .replace(/^💬\s*/i, '')
        .replace(/^say:\s*/i, '')
        .replace(/^[""]|[""]$/g, '')  // Remove quotes
        .trim();
      dialogue += (dialogue ? '\n' : '') + cleaned;
    }
  }
  
  return { visual, dialogue };
}

/**
 * Truncate text to fit in card while keeping it readable
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate HTML template for a single section card
 */
function generateCardTemplate(
  sectionKey: 'hook' | 'body' | 'cta',
  lines: string[],
  variationTag: string
): string {
  const meta = SECTION_META[sectionKey];
  const { visual, dialogue } = extractVisualAndDialogue(lines);
  
  // Truncate for card fit
  const displayVisual = truncateText(visual || 'Visual direction here...', 200);
  const displayDialogue = truncateText(dialogue || 'Dialogue here...', 300);
  
  return `
    <div style="display: flex; flex-direction: column; width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; padding: 48px; font-family: 'Poppins'; background: linear-gradient(180deg, ${COLORS.bgDark} 0%, ${COLORS.bgCard} 100%); color: ${COLORS.textMain};">
      
      <!-- Top Bar: Brand + Variation + Timing -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px;">
        
        <!-- Brand -->
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="display: flex; font-size: 20px; font-weight: 800; color: ${COLORS.textMain}; letter-spacing: -0.5px;">SCRIPT<span style="color: ${meta.accent};">FLOW</span></div>
        </div>
        
        <!-- Variation + Timing Badges -->
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="display: flex; background: ${COLORS.accentBg}; border: 1px solid ${COLORS.accentBorder}; padding: 6px 14px; border-radius: 20px;">
            <span style="font-size: 12px; font-weight: 700; color: ${meta.accent};">${variationTag}</span>
          </div>
          <div style="display: flex; background: rgba(255,255,255,0.05); border: 1px solid ${COLORS.border}; padding: 6px 14px; border-radius: 20px;">
            <span style="font-size: 12px; font-weight: 600; color: ${COLORS.textDim};">⏱ ${meta.timing}</span>
          </div>
        </div>
      </div>
      
      <!-- Section Header -->
      <div style="display: flex; flex-direction: column; align-items: center; margin-bottom: 40px; padding: 24px; background: rgba(${sectionKey === 'hook' ? '34, 211, 238' : sectionKey === 'body' ? '167, 139, 250' : '74, 222, 128'}, 0.1); border-radius: 16px; border: 1px solid ${meta.accent}40;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
          <span style="font-size: 32px;">${meta.emoji}</span>
          <span style="font-size: 28px; font-weight: 800; color: ${meta.accent}; letter-spacing: 2px;">${meta.number} / ${meta.title}</span>
        </div>
        <span style="font-size: 14px; color: ${COLORS.textDim}; font-weight: 500;">${meta.subtitle}</span>
      </div>
      
      <!-- Content Area -->
      <div style="display: flex; flex-direction: column; flex: 1; gap: 24px;">
        
        <!-- Visual Direction -->
        <div style="display: flex; flex-direction: column; padding: 24px; background: ${COLORS.bgSection}; border-radius: 12px; border: 1px solid ${COLORS.border};">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            <span style="font-size: 11px; font-weight: 800; color: ${COLORS.textMuted}; text-transform: uppercase; letter-spacing: 2px;">📹 VISUAL DIRECTION</span>
          </div>
          <div style="display: flex; font-size: 16px; color: ${COLORS.textDim}; line-height: 1.6; font-style: italic;">${escapeHtml(displayVisual)}</div>
        </div>
        
        <!-- Dialogue -->
        <div style="display: flex; flex-direction: column; flex: 1; padding: 28px; background: ${COLORS.bgSection}; border-radius: 12px; border: 2px solid ${meta.accent}40;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
            <span style="font-size: 11px; font-weight: 900; color: ${meta.accent}; text-transform: uppercase; letter-spacing: 2.5px;">💬 DIALOGUE</span>
          </div>
          <div style="display: flex; font-size: 22px; font-weight: 600; color: ${COLORS.textMain}; line-height: 1.5; letter-spacing: -0.3px;">"${escapeHtml(displayDialogue)}"</div>
        </div>
        
      </div>
      
      <!-- Footer -->
      <div style="display: flex; justify-content: center; margin-top: 24px;">
        <span style="font-size: 10px; font-weight: 600; color: ${COLORS.textMuted}; letter-spacing: 2px; opacity: 0.6;">SWIPE FOR MORE →</span>
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
    const { uploadToS3 } = await import('../services/s3Service');
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
    
    // Upload all 3 in parallel
    const [hookUrl, bodyUrl, ctaUrl] = await Promise.all([
      uploadImage(hookBuffer, `${prefix}_hook.png`),
      uploadImage(bodyBuffer, `${prefix}_body.png`),
      uploadImage(ctaBuffer, `${prefix}_cta.png`),
    ]);
    
    const totalTime = Date.now() - startTime;
    logger.info(`Carousel images generated and uploaded in ${totalTime}ms`, {
      hookUrl: hookUrl.substring(0, 50) + '...',
      bodyUrl: bodyUrl.substring(0, 50) + '...',
      ctaUrl: ctaUrl.substring(0, 50) + '...',
    });
    
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
