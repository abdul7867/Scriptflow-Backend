import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { html } from 'satori-html';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';
import { logger } from './logger';
import { config } from '../config';

const IMGBB_API_KEY = config.IMGBB_API_KEY;

// Configure Cloudinary using CLOUDINARY_URL
// Format: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
if (config.CLOUDINARY_URL) {
  // Cloudinary auto-configures from CLOUDINARY_URL env variable
  // Just verify it's set - cloudinary SDK reads it automatically
  logger.info('Cloudinary configured via CLOUDINARY_URL');
} else {
  logger.warn('CLOUDINARY_URL not set - image uploads may fail');
}

// Load fonts once (Poppins - universal, modern, excellent readability)
const fontDataBold = fs.readFileSync(path.join(process.cwd(), 'fonts', 'Poppins-Bold.ttf'));
const fontDataSemiBold = fs.readFileSync(path.join(process.cwd(), 'fonts', 'Poppins-SemiBold.ttf'));
const fontDataRegular = fs.readFileSync(path.join(process.cwd(), 'fonts', 'Poppins-Regular.ttf'));

// ============================================
// UNIFIED STYLING PALETTE - SUNSET GOLD + ELECTRIC VIOLET
// Matches copy-page-demo.html exactly
// ============================================
const COLORS = {
  // Background Gradient (matches webpage)
  bgGradientStart: '#0a0a0c',
  bgGradientEnd: '#0f0f12',

  // Text Colors
  textMain: '#fafafa',
  textSecondary: '#a5a5b0',
  textDim: '#e4e4e7',
  textMuted: '#6b6b7a',

  // Primary Accent - Electric Violet
  accent: '#8b5cf6',
  accentBg: 'rgba(139, 92, 246, 0.1)',
  accentBorder: 'rgba(139, 92, 246, 0.3)',
  accentGlow: 'rgba(139, 92, 246, 0.4)',

  // Secondary Accent - Sunset Gold
  accentSecondary: '#f59e0b',
  accentSecondaryBg: 'rgba(245, 158, 11, 0.08)',
  accentSecondaryBorder: 'rgba(245, 158, 11, 0.15)',

  // Content Type Colors (matching demo)
  accentCamera: '#64748b',      // Slate - camera setup
  accentOverlay: '#f59e0b',     // Sunset Gold - text overlay
  accentDialogue: '#a78bfa',    // Light Violet - dialogue
  accentSuccess: '#22c55e',     // Green - success state

  // Card/Section Styling
  cardBg: 'rgba(15, 15, 18, 0.9)',
  cardBorder: 'rgba(139, 92, 246, 0.1)',
  cardShadow: 'rgba(0, 0, 0, 0.3)',

  // Dividers
  divider: 'rgba(139, 92, 246, 0.1)',
  dividerStrong: 'rgba(139, 92, 246, 0.15)',
};

/**
 * Parse script into structured sections with VISUAL/SAY lines
 */
function parseScript(scriptText: string): { hook: string[], body: string[], cta: string[] } {
  const sections = { hook: [] as string[], body: [] as string[], cta: [] as string[] };

  // Split by section headers
  const parts = scriptText.split(/\[(HOOK|BODY|CTA)\]/i);

  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i]?.toUpperCase();
    const content = parts[i + 1]?.trim() || '';

    // Split content into lines
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
 * Format a line with proper styling based on type (VISUAL/📝/SAY)
 * ALIGNED: Matches copy-page-demo.html styling exactly
 * - Uses CAMERA SETUP (slate), ON-SCREEN TEXT (gold), SPEAK THIS (violet)
 */
function formatLine(visual: string | null, say: string | null, isLast: boolean = false): string {
  const borderStyle = isLast ? '' : `border-bottom: 1px solid ${COLORS.divider};`;

  // Extract text overlay if present (📝 TEXT OVERLAY: format)
  let cameraText = visual || '';
  let overlayText = '';

  // Check if visual contains text overlay
  const overlayMatch = cameraText.match(/📝\s*TEXT\s*OVERLAY:\s*([^\n]+)/i);
  if (overlayMatch) {
    overlayText = overlayMatch[1].trim().replace(/^["']|["']$/g, '');
    cameraText = cameraText.replace(/📝\s*TEXT\s*OVERLAY:\s*[^\n]+\n?/i, '').trim();
  }

  // Clean camera text - remove 🎬 VISUAL: prefix
  cameraText = cameraText.replace(/^🎬\s*VISUAL:\s*/i, '').replace(/^VISUAL:\s*/i, '').trim();

  // Generic text fallback (no markers)
  if (!visual?.match(/🎬|VISUAL:|📝/i) && !say?.match(/💬|SAY:/i) && visual) {
    return `<div style="display: flex; padding: 28px; ${borderStyle} color: ${COLORS.textDim}; font-size: 14px; line-height: 2;">${escapeHtml(visual)}</div>`;
  }

  return `<div style="display: flex; align-items: stretch; gap: 0; padding: 32px 0; ${borderStyle}">
    <!-- Visual Side (40%) - Camera Setup + Text Overlay -->
    <div style="display: flex; flex-direction: column; width: 400px; padding-right: 36px; border-right: 2px solid ${COLORS.divider};">
      <!-- Camera Setup Block -->
      <div style="display: flex; flex-direction: column; padding: 16px; background: rgba(100, 116, 139, 0.05); border-radius: 8px; margin-bottom: ${overlayText ? '16px' : '0'};">
        <div style="display: flex; font-size: 9px; font-weight: 700; color: ${COLORS.accentCamera}; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px;">📹 CAMERA SETUP</div>
        <div style="display: flex; font-size: 13px; color: ${COLORS.textSecondary}; line-height: 1.7;">${cameraText ? escapeHtml(cameraText) : '—'}</div>
      </div>
      ${overlayText ? `
      <!-- On-Screen Text Block -->
      <div style="display: flex; flex-direction: column; padding-top: 16px; border-top: 1px dashed ${COLORS.accentSecondaryBorder};">
        <div style="display: flex; font-size: 9px; font-weight: 700; color: ${COLORS.accentOverlay}; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px;">📝 ON-SCREEN TEXT</div>
        <div style="display: flex; font-size: 14px; font-weight: 700; color: ${COLORS.accentOverlay}; background: ${COLORS.accentSecondaryBg}; padding: 10px 14px; border-radius: 8px; border: 1px solid ${COLORS.accentSecondaryBorder};">"${escapeHtml(overlayText)}"</div>
      </div>` : ''}
    </div>
    
    <!-- Dialogue Side (60%) - Speak This -->
    <div style="display: flex; flex-direction: column; flex: 1; padding: 16px 0 16px 40px; background: rgba(139, 92, 246, 0.03); border-radius: 0 8px 8px 0;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
        <span style="display: flex; font-size: 9px; font-weight: 900; color: ${COLORS.accentDialogue}; text-transform: uppercase; letter-spacing: 2.5px;">🎤 SPEAK THIS</span>
      </div>
      <div style="display: flex; font-size: 18px; font-weight: 500; color: ${COLORS.textMain}; line-height: 1.8;">${say ? escapeHtml(say.replace(/^💬\s*SAY:\s*/i, '').replace(/^SAY:\s*/i, '').replace(/^["']|["']$/g, '')) : '—'}</div>
    </div>
  </div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '"') // Satori handles raw quotes better than &quot;
    .replace(/'/g, "'");
}

/**
 * Create section header HTML matching webpage style
 */
function createSectionHeader(title: string): string {
  return `<div style="display: flex; align-items: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid ${COLORS.divider};">
    <div style="display: flex; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 4px; color: ${COLORS.accent};">${title}</div>
  </div>`;
}

/**
 * Format all lines in a section (Pairing Visual + Say)
 */
function formatSection(lines: string[]): string {
  const paired: { visual: string | null, say: string | null }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isVisual = line.includes('🎬') || line.toLowerCase().startsWith('visual:');
    const isSay = line.includes('💬') || line.toLowerCase().startsWith('say:');

    if (isVisual) {
      // Look ahead for a matching SAY
      const nextLine = lines[i + 1];
      if (nextLine && (nextLine.includes('💬') || nextLine.toLowerCase().startsWith('say:'))) {
        paired.push({ visual: line, say: nextLine });
        i++; // skip next
      } else {
        paired.push({ visual: line, say: null });
      }
    } else if (isSay) {
      paired.push({ visual: null, say: line });
    } else {
      paired.push({ visual: line, say: null });
    }
  }

  return paired.map((pair, idx) => formatLine(pair.visual, pair.say, idx === paired.length - 1)).join('\n');
}

export async function generateScriptImage(scriptText: string): Promise<string> {
  const startTime = Date.now();
  logger.info(`Starting script image generation using provider: ${config.IMAGE_PROVIDER}`);
  try {
    // Parse script sections
    const sections = parseScript(scriptText);

    // Build HTML for each section
    const hookHtml = formatSection(sections.hook);
    const bodyHtml = formatSection(sections.body);
    const ctaHtml = formatSection(sections.cta);

    const template = html(`
      <div style="display: flex; flex-direction: column; width: 1080px; padding: 64px; font-family: 'Poppins'; background: linear-gradient(180deg, ${COLORS.bgGradientStart} 0%, ${COLORS.bgGradientEnd} 100%); color: ${COLORS.textMain};">
        
        <!-- Header matching webpage -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 48px; border-bottom: 2px solid ${COLORS.dividerStrong}; padding-bottom: 24px;">
          <div style="display: flex; flex-direction: column;">
            <div style="display: flex; font-size: 32px; font-weight: 900; color: ${COLORS.textMain}; letter-spacing: -1.2px;">SCRIPT<span style="color: ${COLORS.accent}; text-shadow: 0 0 20px ${COLORS.accentGlow};">FLOW</span></div>
            <div style="display: flex; font-size: 10px; color: ${COLORS.textMuted}; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; margin-top: 6px;">Studio Blueprint</div>
          </div>
          <div style="display: flex; align-items: center; background: ${COLORS.accentBg}; border: 1px solid ${COLORS.accentBorder}; padding: 8px 16px; border-radius: 8px;">
            <div style="display: flex; font-size: 11px; font-weight: 800; color: ${COLORS.accent}; letter-spacing: 2px;">✦ V2.5.0</div>
          </div>
        </div>

        <!-- Content Sections matching webpage cards -->
        ${hookHtml ? `
        <div style="display: flex; flex-direction: column; margin-bottom: 32px; background: ${COLORS.cardBg}; border: 1px solid ${COLORS.cardBorder}; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px ${COLORS.cardShadow};">
          ${createSectionHeader('01 / HOOK')}
          <div style="display: flex; flex-direction: column;">
            ${hookHtml}
          </div>
        </div>` : ''}

        ${bodyHtml ? `
        <div style="display: flex; flex-direction: column; margin-bottom: 32px; background: ${COLORS.cardBg}; border: 1px solid ${COLORS.cardBorder}; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px ${COLORS.cardShadow};">
          ${createSectionHeader('02 / BODY')}
          <div style="display: flex; flex-direction: column;">
            ${bodyHtml}
          </div>
        </div>` : ''}

        ${ctaHtml ? `
        <div style="display: flex; flex-direction: column; background: ${COLORS.cardBg}; border: 1px solid ${COLORS.cardBorder}; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px ${COLORS.cardShadow};">
          ${createSectionHeader('03 / CALL TO ACTION')}
          <div style="display: flex; flex-direction: column;">
            ${ctaHtml}
          </div>
        </div>` : ''}

        <!-- Footer matching webpage -->
        <div style="display: flex; justify-content: center; margin-top: 48px;">
          <div style="display: flex; font-size: 11px; font-weight: 600; color: ${COLORS.textMuted}; letter-spacing: 2px; opacity: 0.5;">POWERED BY SCRIPTFLOW AI</div>
        </div>

      </div>
    `);

    // Generate SVG with Satori
    const svg = await satori(template as any, {
      width: 1080,
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

    // Convert SVG to PNG using Resvg
    const resvg = new Resvg(svg, {
      background: 'rgba(0,0,0,0)',
      fitTo: {
        mode: 'width',
        value: 1080,
      },
    });

    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();
    const generationTime = Date.now() - startTime;
    logger.info(`Image generated in ${generationTime}ms (Satori)`);

    // Provider switching logic
    if (config.IMAGE_PROVIDER === 'cloudinary') {
      // Cloudinary Upload
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'manychat_automation',
            resource_type: 'image',
          },
          (error, result) => {
            if (error) {
              logger.error('Cloudinary upload failed:', error);
              return reject(error);
            }
            if (!result || !result.secure_url) {
              return reject(new Error('Cloudinary upload success but no secure_url found'));
            }
            logger.info(`Image uploaded to Cloudinary: ${result.secure_url}`);
            resolve(result.secure_url);
          }
        );

        // Convert buffer to stream and pipe to Cloudinary
        uploadStream.end(pngBuffer);
      });
    } else if (config.IMAGE_PROVIDER === 's3') {
      // Import dynamically to avoid require errors if module is missing? 
      // Better to import at top, but for now assuming user installs deps.
      const { uploadToS3 } = require('../services/s3Service');
      const imageUrl = await uploadToS3(pngBuffer, 'script.png');
      return imageUrl;
    } else {
      // Fallback to ImgBB (Legacy)
      const formData = new FormData();
      formData.append('image', pngBuffer, { filename: 'script.png' });

      const uploadResponse = await axios.post(
        `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
          },
          timeout: 30000
        }
      );

      if (uploadResponse.data && uploadResponse.data.data && uploadResponse.data.data.url) {
        const imageUrl = uploadResponse.data.data.url;
        logger.info(`Image uploaded to ImgBB: ${imageUrl}`);
        return imageUrl;
      } else {
        throw new Error('ImgBB response did not contain URL');
      }
    }

  } catch (error: any) {
    logger.error('Failed to generate or upload image: ' + (error.message || error));
    throw error;
  } finally {
    // MEMORY OPTIMIZATION: Hint GC after heavy image processing
    if (global.gc) {
      setImmediate(() => {
        try { global.gc!(); } catch (e) { /* ignore */ }
      });
    }
  }
}
