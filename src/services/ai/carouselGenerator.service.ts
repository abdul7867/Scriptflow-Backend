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
  storyFormat?: 'story' | 'edgy' | 'tutorial' | 'default';  // Format for layout
  remixType?: string;  // For remix badge (shorter, funnier, etc.)
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

/** Custom SVG Icons for a premium look */
const ICON_SVGS = {
  camera: (color: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
  text: (color: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="9" x2="9" y1="21" y2="9"/></svg>`,
  tip: (color: string) => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1.3.5 2.6 1.5 3.5.8.8 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
  hook: (color: string) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3z"/></svg>`,
  body: (color: string) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
  cta: (color: string) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
  story: (color: string) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`,
  edgy: (color: string) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z" transform="rotate(45, 12, 12)"/></svg>`,
  tutorial: (color: string) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.934a.5.5 0 0 0-.777-.416L16 11"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg>`,
};

/** Section metadata (DEFAULT format) */
const SECTION_META = {
  hook: {
    number: '01',
    title: 'HOOK',
    emoji: '🎬',
    timing: '0-3 sec',
    subtitle: 'Opening pattern interrupt',
    accent: COLORS.hookAccent,
    tip: 'Hook in first 3 words',
    progressDots: '• ○ ○',
  },
  body: {
    number: '02',
    title: 'BODY',
    emoji: '📝',
    timing: '3-15 sec',
    subtitle: 'Main content delivery',
    accent: COLORS.bodyAccent,
    tip: 'Explain the WHY',
    progressDots: '○ • ○',
  },
  cta: {
    number: '03',
    title: 'CTA',
    emoji: '🎯',
    timing: '15-20 sec',
    subtitle: 'Call to action',
    accent: COLORS.ctaAccent,
    tip: 'Clear single action',
    progressDots: '○ ○ •',
  },
};

/** FORMAT-SPECIFIC SECTION CONFIGS */
const FORMAT_CONFIGS: Record<string, typeof SECTION_META> = {
  // Default format - HOOK/BODY/CTA
  default: SECTION_META,

  // STORY FORMAT - Hero's Arc
  story: {
    hook: {
      number: '01',
      title: 'THE BEFORE',
      emoji: '📖',
      timing: '0-5 sec',
      subtitle: 'Your starting point',
      accent: '#8b5cf6',
      tip: 'Show vulnerability',
      progressDots: '• ○ ○',
    },
    body: {
      number: '02',
      title: 'THE TURNING POINT',
      emoji: '💡',
      timing: '5-15 sec',
      subtitle: 'The discovery',
      accent: '#f59e0b',
      tip: 'Eyes widen here',
      progressDots: '○ • ○',
    },
    cta: {
      number: '03',
      title: 'THE AFTER',
      emoji: '✨',
      timing: '15-20 sec',
      subtitle: 'Your transformation',
      accent: '#22c55e',
      tip: 'Confidence is key',
      progressDots: '○ ○ •',
    },
  },

  // EDGY FORMAT - Myth Buster
  edgy: {
    hook: {
      number: '01',
      title: 'THE MYTH',
      emoji: '❌',
      timing: '0-5 sec',
      subtitle: 'What everyone believes',
      accent: '#ef4444',
      tip: 'Sound frustrated',
      progressDots: '• ○ ○',
    },
    body: {
      number: '02',
      title: 'THE TRUTH',
      emoji: '✅',
      timing: '5-15 sec',
      subtitle: 'What actually works',
      accent: '#22c55e',
      tip: 'Drop the truth bomb',
      progressDots: '○ • ○',
    },
    cta: {
      number: '03',
      title: 'THE PROOF',
      emoji: '🔥',
      timing: '15-20 sec',
      subtitle: 'Your evidence',
      accent: '#f59e0b',
      tip: 'Be confident',
      progressDots: '○ ○ •',
    },
  },

  // TUTORIAL FORMAT - Step by Step
  tutorial: {
    hook: {
      number: '①',
      title: 'STEP 1',
      emoji: '📝',
      timing: '0-7 sec',
      subtitle: 'First action',
      accent: '#10b981',
      tip: 'Be enthusiastic',
      progressDots: '① ○ ○',
    },
    body: {
      number: '②',
      title: 'STEP 2',
      emoji: '📝',
      timing: '7-14 sec',
      subtitle: 'Second action',
      accent: '#3b82f6',
      tip: 'Show the how',
      progressDots: '○ ② ○',
    },
    cta: {
      number: '③',
      title: 'STEP 3 + RESULT',
      emoji: '🎯',
      timing: '14-20 sec',
      subtitle: 'Final action + outcome',
      accent: '#8b5cf6',
      tip: 'End with energy',
      progressDots: '○ ○ ③',
    },
  },
};

/** Get section config for format */
function getSectionMeta(format: string | undefined, sectionKey: 'hook' | 'body' | 'cta') {
  const formatConfig = FORMAT_CONFIGS[format || 'default'] || FORMAT_CONFIGS.default;
  return formatConfig[sectionKey];
}

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
 * Handles multiple formats and properly sanitizes content:
 * - Visual:, 🎬 VISUAL:, Camera:
 * - On-Screen:, 📝 TEXT OVERLAY:, Text Overlay:
 * - Dialogue:, 💬 SAY:, Say:
 */
function extractVisualAndDialogue(lines: string[]): { visual: string; textOverlay: string; dialogue: string } {
  let visual = '';
  let textOverlay = '';
  let dialogue = '';

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const lowerLine = trimmedLine.toLowerCase();

    // Check for visual/camera content
    const isVisual = trimmedLine.includes('🎬') ||
      lowerLine.startsWith('visual:') ||
      lowerLine.startsWith('camera:');

    // Check for on-screen/text overlay content
    const isTextOverlay = trimmedLine.includes('📝') ||
      lowerLine.startsWith('text overlay:') ||
      lowerLine.startsWith('on-screen:') ||
      lowerLine.startsWith('text:');

    // Check for dialogue/say content
    const isDialogue = trimmedLine.includes('💬') ||
      lowerLine.startsWith('say:') ||
      lowerLine.startsWith('dialogue:');

    if (isVisual) {
      // Remove ALL possible visual labels
      let cleaned = trimmedLine
        .replace(/^🎬\s*/i, '')
        .replace(/^VISUAL\s*:\s*/i, '')
        .replace(/^Camera\s*:\s*/i, '')
        .replace(/^[\"""]|[\"""]$/g, '')  // Remove all quote types
        .trim();
      if (cleaned) visual += (visual ? ' ' : '') + cleaned;
    } else if (isTextOverlay) {
      // Remove ALL possible text overlay labels
      let cleaned = trimmedLine
        .replace(/^📝\s*/i, '')
        .replace(/^TEXT\s*OVERLAY\s*:\s*/i, '')
        .replace(/^ON-SCREEN\s*:\s*/i, '')
        .replace(/^TEXT\s*:\s*/i, '')
        .replace(/^[\"""]|[\"""]$/g, '')  // Remove all quote types
        .trim();
      if (cleaned) textOverlay += (textOverlay ? ' • ' : '') + cleaned;
    } else if (isDialogue) {
      // Remove ALL possible dialogue labels
      let cleaned = trimmedLine
        .replace(/^💬\s*/i, '')
        .replace(/^SAY\s*:\s*/i, '')
        .replace(/^DIALOGUE\s*:\s*/i, '')
        .replace(/^[\"""]|[\"""]$/g, '')  // Remove all quote types
        .trim();
      if (cleaned) dialogue += (dialogue ? ' ' : '') + cleaned;
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
 * FORMAT-AWARE: Uses format-specific section titles, tips, and progress dots
 * MINIMALIST DESIGN: Clean, uncluttered, stylish, Instagram-optimized
 */
function generateCardTemplate(
  sectionKey: 'hook' | 'body' | 'cta',
  lines: string[],
  variationTag: string,
  format?: string,
  remixType?: string
): string {
  // Get format-specific metadata
  const meta = getSectionMeta(format, sectionKey);
  const { visual, textOverlay, dialogue } = extractVisualAndDialogue(lines);

  // Smart truncation - INCREASED limits for better readability
  const displayVisual = truncateText(visual || 'Camera setup...', 180);
  const displayOverlay = truncateText(textOverlay || '', 100);
  const displayDialogue = truncateText(dialogue || 'Dialogue goes here...', 200);

  // Dynamic font sizing - scales for all content lengths
  const dialogueFontSize = displayDialogue.length > 130 ? 30 :
    displayDialogue.length > 100 ? 36 :
      displayDialogue.length > 60 ? 42 : 48;

  // Format badge (shows STORY/EDGY/TUTORIAL or remix type like SHORTER)
  const formatBadge = remixType ? remixType.toUpperCase() :
    (format && format !== 'default' ? format.toUpperCase() : '');

  return `
    <div style="display: flex; flex-direction: column; width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; padding: 40px; font-family: 'Poppins'; background: ${COLORS.bgDark}; color: ${COLORS.textMain};">
      
      <!-- Compact Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 12px; font-weight: 700; color: ${COLORS.textMuted}; letter-spacing: 2px;">SCRIPTFLOW</span>
          ${formatBadge ? `<span style="font-size: 8px; font-weight: 700; color: ${meta.accent}; background: rgba(139, 92, 246, 0.2); padding: 3px 6px; border-radius: 3px; letter-spacing: 1px;">${formatBadge}</span>` : ''}
        </div>
        <span style="font-size: 10px; color: ${COLORS.textMuted};">${variationTag} • ${meta.timing}</span>
      </div>
      
      <!-- Section Title - More Prominent -->
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px; padding: 12px 16px; background: rgba(139, 92, 246, 0.08); border-radius: 8px;">
        <div style="display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: rgba(139, 92, 246, 0.12); border-radius: 8px;">
          ${sectionKey === 'hook' ? ICON_SVGS.hook(meta.accent) : sectionKey === 'body' ? ICON_SVGS.body(meta.accent) : ICON_SVGS.cta(meta.accent)}
        </div>
        <span style="font-size: 20px; font-weight: 800; color: ${meta.accent}; letter-spacing: 1.5px;">${meta.title}</span>
      </div>
      
      <!-- Main Dialogue - Priority but not overwhelming -->
      <div style="display: flex; align-items: center; justify-content: center; min-height: 200px; max-height: 280px; margin-bottom: 20px;">
        <div style="font-size: ${dialogueFontSize}px; font-weight: 700; color: ${COLORS.textMain}; line-height: 1.35; letter-spacing: -0.5px; text-align: center;">"${escapeHtml(displayDialogue)}"</div>
      </div>
      
      <!-- Supporting Info - LARGER and more readable -->
      <div style="display: flex; flex-direction: column; gap: 12px; flex: 1;">
        
        ${displayOverlay ? `
        <!-- On-Screen Text - LARGER -->
        <div style="display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; background: rgba(245, 158, 11, 0.1); border-left: 4px solid ${COLORS.bodyAccent}; border-radius: 6px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
            ${ICON_SVGS.text(COLORS.bodyAccent)}
            <span style="font-size: 11px; font-weight: 700; color: ${COLORS.bodyAccent}; text-transform: uppercase; letter-spacing: 1.5px;">ON-SCREEN TEXT</span>
          </div>
          <span style="font-size: 18px; font-weight: 600; color: #fbbf24; line-height: 1.4;">"${escapeHtml(displayOverlay)}"</span>
        </div>
        ` : ''}
        
        <!-- Camera Setup - LARGER -->
        <div style="display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; background: rgba(100, 116, 139, 0.08); border-left: 4px solid ${COLORS.cameraColor}; border-radius: 6px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
            ${ICON_SVGS.camera(COLORS.cameraColor)}
            <span style="font-size: 11px; font-weight: 700; color: ${COLORS.cameraColor}; text-transform: uppercase; letter-spacing: 1.5px;">CAMERA SETUP</span>
          </div>
          <span style="font-size: 14px; color: ${COLORS.textSecondary}; line-height: 1.5;">${escapeHtml(displayVisual)}</span>
        </div>
        
      </div>
      
      <!-- Footer: Progress dots -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(139, 92, 246, 0.1);">
        <span style="font-size: 14px; letter-spacing: 4px; color: ${COLORS.textMuted};">${meta.progressDots}</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${ICON_SVGS.tip(COLORS.textMuted)}
          <span style="font-size: 10px; color: ${COLORS.textMuted}; font-style: italic;">${meta.tip}</span>
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
 * @param format - Story format: 'story', 'edgy', 'tutorial', or 'default'
 * @param remixType - Remix type for badge: 'shorter', 'funnier', etc.
 * @returns CarouselImages with URLs for each card
 * 
 * @example
 * const images = await generateCarouselImages(scriptText, 0, 'story');
 * // images.hookCard = "https://..." (shows THE BEFORE)
 * // images.bodyCard = "https://..." (shows THE TURNING POINT)
 * // images.ctaCard = "https://..." (shows THE AFTER)
 */
export async function generateCarouselImages(
  scriptText: string,
  variationIndex: number = 0,
  format?: string,
  remixType?: string
): Promise<CarouselImages> {
  const startTime = Date.now();
  const variationTag = getVariationTag(variationIndex);

  logger.info('Generating carousel images', { variationIndex, variationTag, format, remixType });

  try {
    // Parse script into sections
    const sections = parseScriptSections(scriptText);

    // Generate unique filenames with timestamp
    const timestamp = Date.now();
    const prefix = `carousel_${timestamp}_${variationTag}`;

    // Generate all 3 cards in parallel - pass format and remixType
    const [hookBuffer, bodyBuffer, ctaBuffer] = await Promise.all([
      renderToPng(generateCardTemplate('hook', sections.hook, variationTag, format, remixType)),
      renderToPng(generateCardTemplate('body', sections.body, variationTag, format, remixType)),
      renderToPng(generateCardTemplate('cta', sections.cta, variationTag, format, remixType)),
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
