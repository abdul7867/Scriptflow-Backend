import { Request, Response } from 'express';
import crypto from 'crypto';
import { Script } from '../db/models';
import { logger } from '../utils/logger';
import { config } from '../config';

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
 * Parse script into sections
 */
function parseScriptSections(scriptText: string): { hook: string; body: string; cta: string } {
  const sections = { hook: '', body: '', cta: '' };
  
  // Split by section headers
  const parts = scriptText.split(/\[(HOOK|BODY|CTA)\]/i);
  
  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i]?.toUpperCase();
    const content = parts[i + 1]?.trim() || '';
    
    if (header === 'HOOK') sections.hook = content;
    else if (header === 'BODY') sections.body = content;
    else if (header === 'CTA') sections.cta = content;
  }
  
  return sections;
}

/**
 * Generate the HTML page for viewing and copying the script
 * ENHANCED: Section-specific copy, better visual hierarchy, polished design
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
  
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Poppins', sans-serif;
      background: linear-gradient(180deg, #09090b 0%, #18181b 100%);
      color: #fafafa;
      min-height: 100vh;
      padding: 20px;
      padding-bottom: 120px;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 32px;
      padding-bottom: 20px;
      border-bottom: 2px solid rgba(255,255,255,0.08);
    }
    
    .logo {
      font-size: 24px;
      font-weight: 900;
      letter-spacing: -0.8px;
    }
    
    .logo span {
      color: #22d3ee;
      text-shadow: 0 0 20px rgba(34, 211, 238, 0.4);
    }
    
    .badge {
      font-size: 10px;
      color: #22d3ee;
      background: rgba(34, 211, 238, 0.1);
      border: 1px solid rgba(34, 211, 238, 0.3);
      padding: 6px 12px;
      border-radius: 6px;
      font-weight: 700;
      letter-spacing: 2px;
    }
    
    .idea {
      font-size: 13px;
      color: #d4d4d8;
      margin-bottom: 32px;
      padding: 16px 20px;
      background: rgba(255,255,255,0.04);
      border-radius: 12px;
      border-left: 4px solid #22d3ee;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
    }
    
    .idea-label {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 3px;
      color: #22d3ee;
      margin-bottom: 8px;
    }
    
    .section-card {
      background: rgba(24, 24, 27, 0.6);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(10px);
    }
    
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    
    .section-title {
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 4px;
      color: #22d3ee;
    }
    
    .copy-section-btn {
      background: rgba(34, 211, 238, 0.1);
      border: 1px solid rgba(34, 211, 238, 0.3);
      color: #22d3ee;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      letter-spacing: 1px;
    }
    
    .copy-section-btn:hover {
      background: rgba(34, 211, 238, 0.2);
      border-color: rgba(34, 211, 238, 0.5);
    }
    
    .copy-section-btn:active {
      transform: scale(0.95);
    }
    
    .copy-section-btn.copied {
      background: rgba(34, 197, 94, 0.2);
      border-color: rgba(34, 197, 94, 0.5);
      color: #22c55e;
    }
    
    .section-text {
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 14px;
      line-height: 2;
      color: #e4e4e7;
      white-space: pre-wrap;
      word-break: break-word;
      user-select: all;
      -webkit-user-select: all;
    }
    
    .copy-all-button {
      position: fixed;
      bottom: 20px;
      left: 20px;
      right: 20px;
      background: linear-gradient(135deg, #22d3ee 0%, #06b6d4 100%);
      color: #09090b;
      border: none;
      border-radius: 14px;
      padding: 18px 28px;
      font-size: 17px;
      font-weight: 800;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      box-shadow: 0 12px 36px rgba(34, 211, 238, 0.4);
      transition: all 0.2s ease;
      z-index: 1000;
      letter-spacing: 0.5px;
    }
    
    .copy-all-button:active {
      transform: scale(0.97);
    }
    
    .copy-all-button.copied {
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      box-shadow: 0 12px 36px rgba(34, 197, 94, 0.4);
    }
    
    .copy-icon {
      width: 22px;
      height: 22px;
    }
    
    .footer {
      text-align: center;
      font-size: 11px;
      color: #52525b;
      margin-top: 32px;
      letter-spacing: 2px;
    }

    @media (min-width: 768px) {
      body {
        max-width: 800px;
        margin: 0 auto;
        padding: 40px;
      }
      
      .copy-all-button {
        left: 50%;
        right: auto;
        transform: translateX(-50%);
        max-width: 400px;
      }
      
      .copy-all-button:active {
        transform: translateX(-50%) scale(0.97);
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">SCRIPT<span>FLOW</span></div>
    <div class="badge">✦ COPY READY</div>
  </div>
  
  <div class="idea">
    <div class="idea-label">💡 Your Concept</div>
    ${escapedIdea}
  </div>
  
  ${sections.hook ? `
  <div class="section-card">
    <div class="section-header">
      <div class="section-title">01 / HOOK</div>
      <button class="copy-section-btn" onclick="copySection('hook')">
        <span class="copy-text-hook">COPY</span>
      </button>
    </div>
    <pre class="section-text" id="hookText">${escapeHtml(sections.hook)}</pre>
  </div>
  ` : ''}
  
  ${sections.body ? `
  <div class="section-card">
    <div class="section-header">
      <div class="section-title">02 / BODY</div>
      <button class="copy-section-btn" onclick="copySection('body')">
        <span class="copy-text-body">COPY</span>
      </button>
    </div>
    <pre class="section-text" id="bodyText">${escapeHtml(sections.body)}</pre>
  </div>
  ` : ''}
  
  ${sections.cta ? `
  <div class="section-card">
    <div class="section-header">
      <div class="section-title">03 / CALL TO ACTION</div>
      <button class="copy-section-btn" onclick="copySection('cta')">
        <span class="copy-text-cta">COPY</span>
      </button>
    </div>
    <pre class="section-text" id="ctaText">${escapeHtml(sections.cta)}</pre>
  </div>
  ` : ''}
  
  <button class="copy-all-button" id="copyAllBtn" onclick="copyAll()">
    <svg class="copy-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
    </svg>
    <span id="copyAllText">COPY ENTIRE SCRIPT</span>
  </button>
  
  <div class="footer">
    POWERED BY SCRIPTFLOW AI
  </div>
  
  <script>
    const fullScript = ${JSON.stringify(scriptText)};
    
    async function copySection(section) {
      const elementId = section + 'Text';
      const textElement = document.getElementById(elementId);
      const btnTextElement = document.querySelector('.copy-text-' + section);
      const btnElement = btnTextElement.parentElement;
      
      if (!textElement) return;
      
      const text = textElement.innerText;
      
      try {
        await navigator.clipboard.writeText(text);
        btnElement.classList.add('copied');
        btnTextElement.innerText = '✓ COPIED';
        
        setTimeout(function() {
          btnElement.classList.remove('copied');
          btnTextElement.innerText = 'COPY';
        }, 2000);
      } catch (err) {
        fallbackCopy(text, btnElement, btnTextElement, 'COPY');
      }
    }
    
    async function copyAll() {
      const btn = document.getElementById('copyAllBtn');
      const btnText = document.getElementById('copyAllText');
      
      try {
        await navigator.clipboard.writeText(fullScript);
        btn.classList.add('copied');
        btnText.innerText = '✓ COPIED TO CLIPBOARD!';
        
        setTimeout(function() {
          btn.classList.remove('copied');
          btnText.innerText = 'COPY ENTIRE SCRIPT';
        }, 2000);
      } catch (err) {
        fallbackCopy(fullScript, btn, btnText, 'COPY ENTIRE SCRIPT');
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
