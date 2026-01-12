import { Request, Response } from 'express';
import crypto from 'crypto';
import { Script } from '../../db/models';
import { logger } from '../../utils/logger';
import { config } from '../../config';

/**
 * Generate a short, URL-safe ID (8 chars for better collision resistance)
 * Uses crypto.randomBytes for cryptographically secure randomness
 */
export function generatePublicId(): string {
  // Use 6 bytes = 48 bits of entropy, base64url encoded = 8 chars
  // Collision probability: 1 in 281 trillion for 1M scripts
  return crypto.randomBytes(6).toString('base64url');
}

/**
 * Generate unique publicId with collision check
 * Retries up to 3 times if collision occurs (extremely rare)
 */
export async function generateUniquePublicId(): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const publicId = generatePublicId();

    // Check if already exists
    const existing = await Script.findOne({ publicId }).select('_id').lean();
    if (!existing) {
      return publicId;
    }

    logger.warn(`PublicId collision detected: ${publicId}, retrying...`);
  }

  // Fallback: Use longer ID (12 chars) if collisions persist
  return crypto.randomBytes(9).toString('base64url');
}

/**
 * Build the full public URL for a script
 * Uses config.BASE_URL with fallback to localhost
 */
export function buildScriptUrl(publicId: string): string {
  const baseUrl = config.BASE_URL || `http://localhost:${config.PORT}`;
  return `${baseUrl}/s/${publicId}`;
}

/**
 * GET /s/:publicId - Public script viewing page
 * Returns an HTML page with the script text and a copy button
 * 
 * SECURITY:
 * - Input validation on publicId format
 * - HTML escaping for XSS prevention
 * - noindex, nofollow for privacy
 * - Cache headers for performance
 */
export const viewScriptHandler = async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;

    // SECURITY: Validate publicId format (base64url chars only, 6-12 chars)
    if (!publicId || !/^[A-Za-z0-9_-]{6,12}$/.test(publicId)) {
      return res.status(400).send(generateErrorPage('Invalid script link'));
    }

    const script = await Script.findOne({ publicId }).lean();

    if (!script) {
      return res.status(404).send(generateErrorPage('Script not found or expired'));
    }

    // Set cache headers (1 hour - scripts are immutable)
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    // SECURITY: X-Content-Type-Options to prevent MIME sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.send(generateScriptPage(script.scriptText, script.userIdea));

  } catch (error) {
    logger.error('Failed to view script:', error);
    res.status(500).send(generateErrorPage('Something went wrong'));
  }
};

/**
 * Escape HTML to prevent XSS attacks
 */
function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Parsed visual-dialogue pair
 * ENHANCED V2: Added textOverlay field for separate TEXT OVERLAY extraction
 */
interface VisualDialoguePair {
  visual: string;
  textOverlay: string;  // NEW: Separate field for 📝 TEXT OVERLAY
  dialogue: string;
}

/**
 * Parsed section with multiple visual/dialogue pairs
 */
interface ParsedSection {
  pairs: VisualDialoguePair[];
  rawText: string;
}

/**
 * Parse script into sections with visual and dialogue extraction
 */
function parseScriptSections(scriptText: string): { hook: ParsedSection; body: ParsedSection; cta: ParsedSection } {
  const sections = {
    hook: { pairs: [] as VisualDialoguePair[], rawText: '' },
    body: { pairs: [] as VisualDialoguePair[], rawText: '' },
    cta: { pairs: [] as VisualDialoguePair[], rawText: '' }
  };

  // Split by section headers
  const parts = scriptText.split(/\[(HOOK|BODY|CTA)\]/i);

  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i]?.toUpperCase();
    const content = parts[i + 1]?.trim() || '';

    const parsed = extractVisualDialoguePairs(content);

    if (header === 'HOOK') sections.hook = parsed;
    else if (header === 'BODY') sections.body = parsed;
    else if (header === 'CTA') sections.cta = parsed;
  }

  return sections;
}

/**
 * Extract visual, text overlay, and dialogue from section content
 * ENHANCED V2: Added TEXT OVERLAY extraction for separate on-screen text
 */
function extractVisualDialoguePairs(content: string): ParsedSection {
  const pairs: VisualDialoguePair[] = [];
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let currentVisual = '';
  let currentTextOverlay = '';
  let currentDialogue = '';

  for (const line of lines) {
    // Check for visual marker (🎬 VISUAL: or just visual:)
    const visualMatch = line.match(/^(?:🎬\s*)?(?:VISUAL|Visual)\s*:\s*(.+)/i);
    // Check for text overlay marker (📝 TEXT OVERLAY: or just text overlay:)
    const textOverlayMatch = line.match(/^(?:📝\s*)?(?:TEXT OVERLAY|Text Overlay|TEXT_OVERLAY)\s*:\s*(.+)/i);
    // Check for dialogue marker (💬 SAY: or just say:)
    const dialogueMatch = line.match(/^(?:💬\s*)?(?:SAY|Say)\s*:\s*(.+)/i);

    if (visualMatch) {
      // If we have a previous pair, save it
      if (currentVisual || currentDialogue || currentTextOverlay) {
        pairs.push({
          visual: currentVisual.trim(),
          textOverlay: currentTextOverlay.trim(),
          dialogue: currentDialogue.trim()
        });
      }
      currentVisual = visualMatch[1].replace(/^[""]|[""]$/g, '').trim();
      currentTextOverlay = '';
      currentDialogue = '';
    } else if (textOverlayMatch) {
      currentTextOverlay = textOverlayMatch[1].replace(/^[""]|[""]$/g, '').trim();
    } else if (dialogueMatch) {
      currentDialogue = dialogueMatch[1].replace(/^[""]|[""]$/g, '').trim();
    }
  }

  // Don't forget the last pair
  if (currentVisual || currentDialogue || currentTextOverlay) {
    pairs.push({
      visual: currentVisual.trim(),
      textOverlay: currentTextOverlay.trim(),
      dialogue: currentDialogue.trim()
    });
  }

  return { pairs, rawText: content };
}

/**
 * Generate HTML for a single content pair (visual + text overlay + dialogue)
 * ENHANCED V2: Added TEXT OVERLAY with distinct visual styling
 */
function generatePairHtml(pair: VisualDialoguePair, index: number, sectionId: string): string {
  const hasVisual = pair.visual && pair.visual.length > 0;
  const hasTextOverlay = pair.textOverlay && pair.textOverlay.length > 0;
  const hasDialogue = pair.dialogue && pair.dialogue.length > 0;

  if (!hasVisual && !hasDialogue && !hasTextOverlay) return '';

  const dialogueId = `${sectionId}-dialogue-${index}`;

  return `
    <div class="content-pair">
      ${hasVisual ? `
        <div class="visual-block">
          <div class="block-label">📹 CAMERA SETUP</div>
          <div class="visual-text">${escapeHtml(pair.visual)}</div>
          ${hasTextOverlay ? `
            <div class="text-overlay-container">
              <div class="block-label overlay-label">📝 ON-SCREEN TEXT</div>
              <div class="text-overlay">"${escapeHtml(pair.textOverlay)}"</div>
            </div>
          ` : ''}
        </div>
      ` : ''}
      ${hasDialogue ? `
        <div class="dialogue-block">
          <div class="dialogue-header">
            <div class="block-label dialogue-label">🎤 SPEAK THIS</div>
            <button class="copy-dialogue-btn" onclick="copyDialogue('${dialogueId}')" data-id="${dialogueId}">
              <span class="copy-dialogue-text">COPY</span>
            </button>
          </div>
          <div class="dialogue-text" id="${dialogueId}">"${escapeHtml(pair.dialogue)}"</div>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Generate section HTML with proper visual/dialogue separation
 */
function generateSectionHtml(section: ParsedSection, title: string, number: string, sectionId: string): string {
  if (!section || section.pairs.length === 0) return '';

  const pairsHtml = section.pairs.map((pair, idx) => generatePairHtml(pair, idx, sectionId)).join('');

  // Generate raw text for copying (dialogue only for cleaner copy)
  const rawDialogue = section.pairs.map(p => p.dialogue).filter(d => d).join('\n\n');

  return `
    <div class="section-card">
      <div class="section-header">
        <div class="section-title">${number} / ${title}</div>
        <button class="copy-section-btn" onclick="copySection('${sectionId}')">
          <span class="copy-text-${sectionId}">COPY ALL</span>
        </button>
      </div>
      <div class="section-content">
        ${pairsHtml}
      </div>
      <textarea class="hidden-text" id="${sectionId}Text">${escapeHtml(rawDialogue)}</textarea>
    </div>
  `;
}

/**
 * Generate the HTML page for viewing and copying the script
 * ENHANCED: Clean visual/dialogue separation with proper hierarchy
 */
function generateScriptPage(scriptText: string, userIdea: string): string {
  const escapedIdea = escapeHtml(userIdea);
  const sections = parseScriptSections(scriptText);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Your Script | ScriptFlow</title>
  <meta name="description" content="Your AI-generated video script - tap to copy">
  <meta name="robots" content="noindex, nofollow">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0a0a0c;
      color: #fafafa;
      min-height: 100vh;
      padding: 16px;
      padding-bottom: 100px;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    
    .logo {
      font-size: 18px;
      font-weight: 900;
      letter-spacing: -0.5px;
    }
    
    .logo span {
      background: linear-gradient(135deg, #8b5cf6 0%, #f59e0b 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .badge {
      font-size: 9px;
      background: linear-gradient(135deg, #8b5cf6 0%, #f59e0b 100%);
      color: white;
      padding: 5px 10px;
      border-radius: 4px;
      font-weight: 700;
      letter-spacing: 1.5px;
    }
    
    .idea {
      font-size: 13px;
      color: #a1a1aa;
      margin-bottom: 24px;
      padding: 12px 16px;
      background: rgba(15, 15, 18, 0.9);
      border-radius: 8px;
      border-left: 3px solid #8b5cf6;
    }
    
    .idea-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 2px;
      background: linear-gradient(135deg, #8b5cf6 0%, #f59e0b 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 6px;
    }
    
    .section-card {
      background: rgba(15, 15, 18, 0.9);
      border: 1px solid rgba(139, 92, 246, 0.1);
      border-radius: 16px;
      margin-bottom: 20px;
      overflow: hidden;
      backdrop-filter: blur(20px);
    }
    
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      background: rgba(255,255,255,0.02);
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    
    .section-title {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 3px;
      background: linear-gradient(135deg, #8b5cf6 0%, #f59e0b 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .section-content {
      padding: 0;
    }
    
    .content-pair {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    
    .content-pair:last-child {
      border-bottom: none;
    }
    
    .visual-block {
      padding: 16px 20px;
      background: rgba(0,0,0,0.2);
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    
    .dialogue-block {
      padding: 16px 20px;
    }
    
    .block-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: #52525b;
      margin-bottom: 8px;
    }
    
    .dialogue-label {
      color: #a78bfa;
    }
    
    .overlay-label {
      color: #f59e0b !important;
    }
    
    .text-overlay-container {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed rgba(255,255,255,0.1);
    }
    
    .text-overlay {
      font-size: 14px;
      font-weight: 700;
      color: #fbbf24;
      background: rgba(251, 191, 36, 0.1);
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid rgba(251, 191, 36, 0.2);
    }
    
    .dialogue-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    
    .visual-text {
      font-size: 12px;
      line-height: 1.6;
      color: #71717a;
      font-style: italic;
    }
    
    .dialogue-text {
      font-size: 15px;
      line-height: 1.7;
      color: #fafafa;
      font-weight: 500;
      user-select: all;
      -webkit-user-select: all;
    }
    
    .copy-section-btn {
      background: rgba(139, 92, 246, 0.1);
      border: 1px solid rgba(139, 92, 246, 0.3);
      color: #8b5cf6;
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 9px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
      letter-spacing: 1px;
    }
    
    .copy-dialogue-btn {
      background: rgba(167, 139, 250, 0.1);
      border: 1px solid rgba(167, 139, 250, 0.2);
      color: #a78bfa;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 8px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
      letter-spacing: 1px;
    }
    
    .copy-section-btn:hover, .copy-dialogue-btn:hover {
      transform: translateY(-1px);
    }
    
    .copy-section-btn:active, .copy-dialogue-btn:active {
      transform: scale(0.95);
    }
    
    .copy-section-btn.copied, .copy-dialogue-btn.copied {
      background: rgba(34, 197, 94, 0.15);
      border-color: rgba(34, 197, 94, 0.4);
      color: #22c55e;
    }
    
    .hidden-text {
      position: absolute;
      left: -9999px;
      opacity: 0;
      pointer-events: none;
    }
    
    .copy-all-button {
      position: fixed;
      bottom: 16px;
      left: 16px;
      right: 16px;
      background: linear-gradient(135deg, #8b5cf6 0%, #f59e0b 100%);
      color: white;
      border: none;
      border-radius: 14px;
      padding: 16px 24px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      box-shadow: 0 8px 32px rgba(139, 92, 246, 0.35), 0 8px 32px rgba(245, 158, 11, 0.15);
      transition: all 0.15s ease;
      z-index: 1000;
      letter-spacing: 0.5px;
    }
    
    .copy-all-button:active {
      transform: scale(0.98);
    }
    
    .copy-all-button.copied {
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      box-shadow: 0 8px 32px rgba(34, 197, 94, 0.35);
    }
    
    .copy-icon {
      width: 20px;
      height: 20px;
    }
    
    .footer {
      text-align: center;
      font-size: 10px;
      color: #3f3f46;
      margin-top: 24px;
      letter-spacing: 2px;
    }

    /* Desktop: Side-by-side layout */
    @media (min-width: 768px) {
      body {
        max-width: 900px;
        margin: 0 auto;
        padding: 32px;
        padding-bottom: 100px;
      }
      
      .content-pair {
        grid-template-columns: 35% 65%;
        gap: 0;
      }
      
      .visual-block {
        border-bottom: none;
        border-right: 1px solid rgba(255,255,255,0.04);
        padding: 20px 24px;
      }
      
      .dialogue-block {
        padding: 20px 24px;
      }
      
      .dialogue-text {
        font-size: 17px;
      }
      
      .copy-all-button {
        left: 50%;
        right: auto;
        transform: translateX(-50%);
        max-width: 360px;
      }
      
      .copy-all-button:active {
        transform: translateX(-50%) scale(0.98);
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">SCRIPT<span>FLOW</span></div>
    <div class="badge">✦ V0.8</div>
  </div>
  
  <div class="idea">
    <div class="idea-label">💡 Your Concept</div>
    ${escapedIdea}
  </div>
  
  ${generateSectionHtml(sections.hook, 'HOOK', '01', 'hook')}
  ${generateSectionHtml(sections.body, 'BODY', '02', 'body')}
  ${generateSectionHtml(sections.cta, 'CALL TO ACTION', '03', 'cta')}
  
  <button class="copy-all-button" id="copyAllBtn" onclick="copyAll()">
    <svg class="copy-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
    </svg>
    <span id="copyAllText">COPY DIALOGUE</span>
  </button>
  
  <div class="footer">
    POWERED BY SCRIPTFLOW AI
  </div>
  
  <script>
    // Get all dialogue text for the full copy
    function getAllDialogue() {
      const dialogues = document.querySelectorAll('.dialogue-text');
      const texts = [];
      dialogues.forEach(function(el) {
        const text = el.innerText.replace(/^"|"$/g, '').trim();
        if (text) texts.push(text);
      });
      return texts.join('\\n\\n');
    }
    
    async function copyDialogue(dialogueId) {
      const textElement = document.getElementById(dialogueId);
      const btn = document.querySelector('[data-id="' + dialogueId + '"]');
      const btnText = btn.querySelector('.copy-dialogue-text');
      
      if (!textElement) return;
      
      // Remove quotes from the text
      const text = textElement.innerText.replace(/^"|"$/g, '').trim();
      
      try {
        await navigator.clipboard.writeText(text);
        btn.classList.add('copied');
        btnText.innerText = '✓';
        
        setTimeout(function() {
          btn.classList.remove('copied');
          btnText.innerText = 'COPY';
        }, 1500);
      } catch (err) {
        fallbackCopy(text, btn, btnText, 'COPY');
      }
    }
    
    async function copySection(section) {
      const elementId = section + 'Text';
      const textElement = document.getElementById(elementId);
      const btnTextElement = document.querySelector('.copy-text-' + section);
      const btnElement = btnTextElement.parentElement;
      
      if (!textElement) return;
      
      const text = textElement.value || textElement.innerText;
      
      try {
        await navigator.clipboard.writeText(text);
        btnElement.classList.add('copied');
        btnTextElement.innerText = '✓ COPIED';
        
        setTimeout(function() {
          btnElement.classList.remove('copied');
          btnTextElement.innerText = 'COPY ALL';
        }, 2000);
      } catch (err) {
        fallbackCopy(text, btnElement, btnTextElement, 'COPY ALL');
      }
    }
    
    async function copyAll() {
      const btn = document.getElementById('copyAllBtn');
      const btnText = document.getElementById('copyAllText');
      const allDialogue = getAllDialogue();
      
      try {
        await navigator.clipboard.writeText(allDialogue);
        btn.classList.add('copied');
        btnText.innerText = '✓ COPIED!';
        
        setTimeout(function() {
          btn.classList.remove('copied');
          btnText.innerText = 'COPY DIALOGUE';
        }, 2000);
      } catch (err) {
        fallbackCopy(allDialogue, btn, btnText, 'COPY DIALOGUE');
      }
    }
    
    function fallbackCopy(text, btn, btnText, originalText) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      
      try {
        document.execCommand('copy');
        btn.classList.add('copied');
        btnText.innerText = '✓ COPIED!';
        setTimeout(function() {
          btn.classList.remove('copied');
          btnText.innerText = originalText;
        }, 2000);
      } catch (e) {
        btnText.innerText = 'Long-press to copy';
      }
      
      document.body.removeChild(textarea);
    }
  </script>
</body>
</html>`;
}

/**
 * Generate an error page
 * SECURITY: Message is escaped to prevent XSS
 */
function generateErrorPage(message: string): string {
  const escapedMessage = escapeHtml(message);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error | ScriptFlow</title>
  <meta name="robots" content="noindex, nofollow">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #09090b;
      color: #fafafa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 20px;
    }
    .error-container {
      max-width: 400px;
    }
    h1 {
      font-size: 48px;
      margin-bottom: 16px;
    }
    p {
      color: #a1a1aa;
      font-size: 16px;
    }
    .logo {
      font-size: 14px;
      color: #52525b;
      margin-top: 32px;
    }
    .logo span { color: #22d3ee; }
  </style>
</head>
<body>
  <div class="error-container">
    <h1>😕</h1>
    <p>${escapedMessage}</p>
    <div class="logo">SCRIPT<span>FLOW</span></div>
  </div>
</body>
</html>`;
}
