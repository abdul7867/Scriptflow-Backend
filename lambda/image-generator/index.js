const { Resvg } = require('@resvg/resvg-js');
const satori = require('satori').default;
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

// Dynamic import helper for ESM modules
let satoriHtml;
async function loadSatoriHtml() {
    if (!satoriHtml) {
        const module = await import('satori-html');
        satoriHtml = module.html;
    }
    return satoriHtml;
}

const CONFIG = {
    CLOUDINARY_URL: process.env.CLOUDINARY_URL,
    IMGBB_API_KEY: process.env.IMGBB_API_KEY,
    IMAGE_PROVIDER: process.env.IMAGE_PROVIDER || 'cloudinary'
};

if (CONFIG.CLOUDINARY_URL) {
    cloudinary.config({
        cloud_name: CONFIG.CLOUDINARY_URL.split('@')[1],
        api_key: CONFIG.CLOUDINARY_URL.split('://')[1].split(':')[0],
        api_secret: CONFIG.CLOUDINARY_URL.split(':')[2].split('@')[0]
    });
}

let fontDataBold, fontDataSemiBold, fontDataRegular;
try {
    fontDataBold = fs.readFileSync(path.join(__dirname, 'fonts', 'Poppins-Bold.ttf'));
    fontDataSemiBold = fs.readFileSync(path.join(__dirname, 'fonts', 'Poppins-SemiBold.ttf'));
    fontDataRegular = fs.readFileSync(path.join(__dirname, 'fonts', 'Poppins-Regular.ttf'));
} catch (e) { console.error(e); }

const COLORS = {
    bgDark: '#0a0a0c', textMain: '#fafafa', textMuted: '#6b6b7a',
    accent: '#8b5cf6', accentSecondary: '#f59e0b', accentCamera: '#64748b', accentOverlay: '#f59e0b', accentSuccess: '#22c55e',
};

const ICON_SVGS = {
    camera: (c) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
    text: (c) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="9" x2="9" y1="21" y2="9"/></svg>`,
    tip: (c) => `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1.3.5 2.6 1.5 3.5.8.8 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
    hook: (c) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3z"/></svg>`,
    body: (c) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    cta: (c) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
};

const SECTION_META = {
    hook: { title: 'HOOK', timing: '0-3s', accent: COLORS.accent, tip: 'Hook fast', progress: '• ○ ○' },
    body: { title: 'BODY', timing: '3-15s', accent: COLORS.accentSecondary, tip: 'Explain why', progress: '○ • ○' },
    cta: { title: 'CTA', timing: '15-20s', accent: COLORS.accentSuccess, tip: 'Call to action', progress: '○ ○ •' }
};

const FORMAT_CONFIGS = {
    default: SECTION_META,
    story: {
        hook: { title: 'THE BEFORE', timing: '0-5s', accent: '#8b5cf6', tip: 'Vulnerable', progress: '• ○ ○' },
        body: { title: 'TURNING POINT', timing: '5-15s', accent: '#f59e0b', tip: 'Discovery', progress: '○ • ○' },
        cta: { title: 'THE AFTER', timing: '15-20s', accent: '#22c55e', tip: 'Transformation', progress: '○ ○ •' }
    },
    edgy: {
        hook: { title: 'THE MYTH', timing: '0-5s', accent: '#ef4444', tip: 'Frustrated', progress: '• ○ ○' },
        body: { title: 'THE TRUTH', timing: '5-15s', accent: '#22c55e', tip: 'Truth bomb', progress: '○ • ○' },
        cta: { title: 'THE PROOF', timing: '15-20s', accent: '#f59e0b', tip: 'Evidence', progress: '○ ○ •' }
    },
    tutorial: {
        hook: { title: 'STEP 1', timing: '0-7s', accent: '#10b981', tip: 'Enthusiastic', progress: '① ○ ○' },
        body: { title: 'STEP 2', timing: '7-14s', accent: '#3b82f6', tip: 'Show how', progress: '○ ② ○' },
        cta: { title: 'STEP 3', timing: '14-20s', accent: '#8b5cf6', tip: 'Result', progress: '○ ○ ③' }
    }
};

function escapeHtml(text) { return text ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '"').replace(/'/g, "'") : ''; }
function truncateText(text, maxLength) { if (!text) return ''; return text.length <= maxLength ? text : text.substring(0, maxLength - 3) + '...'; }

function parseScript(scriptText) {
    const sections = { hook: [], body: [], cta: [] };
    const parts = scriptText.split(/(?:🎬|📝|🚀)?\s*\[(HOOK|BODY|CTA)(?:\s*\([^)]*\))?\]/i);
    for (let i = 1; i < parts.length; i += 2) {
        const lines = (parts[i + 1] || '').trim().split('\n').map(l => l.trim()).filter(l => l.length);
        sections[parts[i].toLowerCase()] = lines;
    }
    return sections;
}

function extractVisualAndDialogue(lines) {
    let visual = '', textOverlay = '', dialogue = '';
    for (const line of lines) {
        const t = line.trim(); if (!t) continue; const l = t.toLowerCase();
        if (t.includes('🎬') || l.startsWith('visual:') || l.startsWith('camera:')) visual += (visual ? ' ' : '') + t.replace(/^🎬\s*|VISUAL\s*:\s*|Camera\s*:\s*|["']|["']$/gi, '').trim();
        else if (t.includes('📝') || l.startsWith('text:') || l.startsWith('on-screen:')) textOverlay += (textOverlay ? ' • ' : '') + t.replace(/^📝\s*|TEXT\s*OVERLAY\s*:\s*|ON-SCREEN\s*:\s*|TEXT\s*:\s*|["']|["']$/gi, '').trim();
        else if (t.includes('💬') || l.startsWith('say:') || l.startsWith('dialogue:')) dialogue += (dialogue ? ' ' : '') + t.replace(/^💬\s*|SAY\s*:\s*|DIALOGUE\s*:\s*|["']|["']$/gi, '').trim();
    }
    return { visual, textOverlay, dialogue };
}

function generateCardTemplate(sectionKey, lines, variationTag, format, remixType) {
    const { visual, textOverlay, dialogue } = extractVisualAndDialogue(lines);
    const displayVisual = truncateText(visual || 'Camera setup...', 180);
    const displayOverlay = truncateText(textOverlay || '', 100);
    const displayDialogue = truncateText(dialogue || 'Dialogue...', 200);

    const formatConfig = FORMAT_CONFIGS[format] || FORMAT_CONFIGS.default;
    const meta = formatConfig[sectionKey] || FORMAT_CONFIGS.default[sectionKey];

    const icon = sectionKey === 'hook' ? ICON_SVGS.hook(meta.accent) : sectionKey === 'body' ? ICON_SVGS.body(meta.accent) : ICON_SVGS.cta(meta.accent);
    const formatBadge = remixType ? remixType.toUpperCase() : (format && format !== 'default' ? format.toUpperCase() : '');

    return `<div style="display:flex;flex-direction:column;width:900px;height:900px;padding:40px;font-family:'Poppins';background:${COLORS.bgDark};color:${COLORS.textMain}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;font-weight:700;color:${COLORS.textMuted};letter-spacing:2px">SCRIPTFLOW</span>${formatBadge ? `<span style="font-size:8px;font-weight:700;color:${meta.accent};background:${meta.accent}33;padding:3px 6px;border-radius:3px">${formatBadge}</span>` : ''}</div><span style="font-size:10px;color:${COLORS.textMuted}">${variationTag} • ${meta.timing}</span></div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;padding:12px 16px;background:${meta.accent}22;border-radius:8px"><div style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;background:${meta.accent}33;border-radius:8px">${icon}</div><span style="font-size:20px;font-weight:800;color:${meta.accent};letter-spacing:1.5px">${meta.title}</span></div>
    <div style="display:flex;align-items:center;justify-content:center;min-height:200px;max-height:280px;margin-bottom:20px"><div style="font-size:${displayDialogue.length > 100 ? 36 : 42}px;font-weight:700;color:${COLORS.textMain};line-height:1.35;text-align:center">"${escapeHtml(displayDialogue)}"</div></div>
    <div style="display:flex;flex-direction:column;gap:12px;flex:1">
      ${displayOverlay ? `<div style="display:flex;flex-direction:column;gap:8px;padding:14px 16px;background:${COLORS.accentSecondary}22;border-left:4px solid ${COLORS.accentSecondary};border-radius:6px"><span style="font-size:11px;font-weight:700;color:${COLORS.accentSecondary};text-transform:uppercase">ON-SCREEN TEXT</span><span style="font-size:18px;font-weight:600;color:#fbbf24">"${escapeHtml(displayOverlay)}"</span></div>` : ''}
      <div style="display:flex;flex-direction:column;gap:8px;padding:14px 16px;background:${COLORS.accentCamera}22;border-left:4px solid ${COLORS.accentCamera};border-radius:6px"><span style="font-size:11px;font-weight:700;color:${COLORS.accentCamera};text-transform:uppercase">CAMERA</span><span style="font-size:14px;color:${COLORS.textSecondary}">${escapeHtml(displayVisual)}</span></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:12px;border-top:1px solid ${COLORS.textMuted}33"><span style="font-size:14px;letter-spacing:4px;color:${COLORS.textMuted}">${meta.progress}</span><div style="display:flex;align-items:center;gap:6px">${ICON_SVGS.tip(COLORS.textMuted)}<span style="font-size:10px;color:${COLORS.textMuted};font-style:italic">${meta.tip}</span></div></div>
  </div>`;
}

function generateExtractTemplate(scriptText) {
    const match = scriptText.match(/💬\s*TRANSCRIPT[^:]*:\s*\n?"?([^"]+)"?/i);
    const transcript = match ? match[1].trim() : 'No transcript';
    return `<div style="display:flex;flex-direction:column;width:900px;height:900px;padding:40px;font-family:'Poppins';background:${COLORS.bgDark};color:${COLORS.textMain}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><span style="font-size:14px;font-weight:700;color:${COLORS.textMuted};letter-spacing:2px">SCRIPTFLOW EXTRACT</span></div>
    <div style="font-size:32px;font-weight:600;color:${COLORS.textMain};line-height:1.6">"${escapeHtml(truncateText(transcript, 450))}"</div>
  </div>`;
}

async function uploadImage(buffer) {
    if (CONFIG.IMAGE_PROVIDER === 'cloudinary') {
        return new Promise((resolve, reject) => {
            const s = cloudinary.uploader.upload_stream({ folder: 'scriptflow_lambda', resource_type: 'image' }, (e, r) => e ? reject(e) : resolve(r.secure_url));
            s.end(buffer);
        });
    } else {
        // Fallback to ImgBB
        const formData = new FormData();
        formData.append('image', buffer, { filename: 'script.png' });

        try {
            const response = await axios.post(`https://api.imgbb.com/1/upload?key=${CONFIG.IMGBB_API_KEY}`, formData, {
                headers: formData.getHeaders(),
                timeout: 30000
            });
            if (response.data && response.data.data && response.data.data.url) {
                return response.data.data.url;
            } else {
                throw new Error('ImgBB did not return a URL');
            }
        } catch (error) {
            console.error('ImgBB Upload Error:', error.response ? error.response.data : error.message);
            throw error;
        }
    }
}

async function renderPng(htmlString) {
    const html = await loadSatoriHtml();
    const svg = await satori(html(htmlString), {
        width: 900, height: 900, fonts: [
            { name: 'Poppins', data: fontDataRegular, weight: 400, style: 'normal' },
            { name: 'Poppins', data: fontDataSemiBold, weight: 600, style: 'normal' },
            { name: 'Poppins', data: fontDataBold, weight: 700, style: 'normal' }
        ]
    });
    return new Resvg(svg, { background: 'rgba(0,0,0,0)', fitTo: { mode: 'width', value: 900 } }).render().asPng();
}

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event));
    const { type, scriptText, variationTag = 'v1', format = 'default', remixType } = event;
    try {
        if (type === 'extract') {
            const b = await renderPng(generateExtractTemplate(scriptText));
            return { statusCode: 200, body: JSON.stringify({ url: await uploadImage(b) }) };
        }
        const sections = parseScript(scriptText);
        if (type === 'carousel') {
            const urls = await Promise.all(['hook', 'body', 'cta'].map(s => renderPng(generateCardTemplate(s, sections[s], variationTag, format, remixType)).then(uploadImage)));
            return { statusCode: 200, body: JSON.stringify({ hookUrl: urls[0], bodyUrl: urls[1], ctaUrl: urls[2] }) };
        }
        const b = await renderPng(generateCardTemplate('body', sections.body, variationTag, format, remixType));
        return { statusCode: 200, body: JSON.stringify({ url: await uploadImage(b) }) };
    } catch (e) {
        console.error(e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
