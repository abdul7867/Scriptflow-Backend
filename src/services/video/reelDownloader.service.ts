import ytDlpExec from 'yt-dlp-exec';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import stream from 'stream';
import { promisify } from 'util';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { withCircuitBreaker, CircuitOpenError } from '../../utils/circuitBreaker';

const pipeline = promisify(stream.pipeline);

// Max duration to process (to avoid huge files)
const MAX_DURATION_SEC = 300; // 5 minutes

// Use cookies path from config (supports both Docker and local development)
const getCookiesPath = () => config.INSTAGRAM_COOKIES_PATH;

// Auto-detect yt-dlp binary path (cross-platform)
function getYtDlpBinaryPath(): string | undefined {
  // On Windows, yt-dlp-exec will auto-find in PATH or node_modules
  // On Linux/Docker, check common locations
  const possiblePaths = [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    'yt-dlp' // Let system PATH resolve it
  ];
  
  for (const binPath of possiblePaths) {
    try {
      if (fs.existsSync(binPath)) {
        logger.info(`Found yt-dlp at: ${binPath}`);
        return binPath;
      }
    } catch (e) {
      // Ignore check errors
    }
  }
  
  // Return undefined to let yt-dlp-exec auto-detect
  logger.info('Using yt-dlp from system PATH or node_modules');
  return undefined;
}

const YTDLP_BINARY_PATH = getYtDlpBinaryPath();

// User-Agent rotation for Direct CDN extraction
const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
];


const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

/**
 * Sanitize ID to prevent path traversal attacks
 * SECURITY: Removes any characters that could be used to escape the temp directory
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-_]/g, '');
}

/**
 * TIER 1: Direct CDN Extraction (FASTEST - 2-4s)
 * Performance Optimization PRD Section 4.2.1
 * 
 * Extracts video URL directly from Instagram page's embedded JSON
 * Advantages:
 * - Ultra-fast: 2-4 seconds (70% faster than yt-dlp)
 * - Free: No external costs
 * - Lightweight: No binary dependencies
 * 
 * Note: May require periodic updates if Instagram changes JSON structure
 */
async function downloadViaDirectCDN(url: string, id: string): Promise<string> {
  const tempDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const safeId = sanitizeId(id);
  const outputPath = path.join(tempDir, `${safeId}.mp4`);

  // Clean up existing file
  if (fs.existsSync(outputPath)) {
    try {
      fs.unlinkSync(outputPath);
    } catch (err: any) {
      logger.warn(`[${id}] Failed to delete existing file: ${err.message}`);
    }
  }

  logger.info(`[${id}] Attempting Direct CDN extraction...`);

  // Fetch Instagram page with mobile User-Agent
  const response = await axios.get(url, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate',
      'Connection': 'keep-alive',
    },
    timeout: 10000,
    maxRedirects: 5,
  });

  const html = response.data;
  let videoUrl: string | null = null;

  // Try multiple extraction methods (Instagram changes their JSON structure)

  // Method 1: Try window._sharedData (legacy but still works for some pages)
  const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?});<\/script>/);
  if (sharedDataMatch) {
    try {
      const data = JSON.parse(sharedDataMatch[1]);
      videoUrl = data?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media?.video_url;
    } catch (e) {
      logger.debug(`[${id}] _sharedData parse failed`);
    }
  }

  // Method 2: Try application/ld+json (structured data)
  if (!videoUrl) {
    const ldJsonMatch = html.match(/<script type="application\/ld\+json"[^>]*>([^<]+)<\/script>/);
    if (ldJsonMatch) {
      try {
        const data = JSON.parse(ldJsonMatch[1]);
        videoUrl = data?.video?.[0]?.contentUrl || data?.contentUrl;
      } catch (e) {
        logger.debug(`[${id}] ld+json parse failed`);
      }
    }
  }

  // Method 3: Try __additionalDataLoaded (newer Instagram format)
  if (!videoUrl) {
    const additionalDataMatch = html.match(/window\.__additionalDataLoaded\([^,]+,\s*({.+?})\);<\/script>/);
    if (additionalDataMatch) {
      try {
        const data = JSON.parse(additionalDataMatch[1]);
        const media = data?.graphql?.shortcode_media || data?.items?.[0];
        videoUrl = media?.video_url || media?.video_versions?.[0]?.url;
      } catch (e) {
        logger.debug(`[${id}] additionalDataLoaded parse failed`);
      }
    }
  }

  // Method 4: Direct regex for video URL in page (fallback)
  if (!videoUrl) {
    const urlMatch = html.match(/"video_url"\s*:\s*"([^"]+)"/);
    if (urlMatch) {
      videoUrl = urlMatch[1].replace(/\\u0026/g, '&');
    }
  }

  if (!videoUrl) {
    throw new Error('Could not extract video URL from Instagram page');
  }

  logger.info(`[${id}] Found video URL via Direct CDN extraction`);

  // Download the video from CDN
  const videoResponse = await axios({
    method: 'GET',
    url: videoUrl,
    responseType: 'stream',
    timeout: 60000,
    headers: {
      'User-Agent': getRandomUserAgent(),
    },
  });

  await pipeline(videoResponse.data, fs.createWriteStream(outputPath));

  if (!fs.existsSync(outputPath)) {
    throw new Error('Direct CDN download did not create output file');
  }

  const stats = fs.statSync(outputPath);
  if (stats.size < 1000) {
    throw new Error('Downloaded file too small, likely invalid');
  }

  logger.info(`[${id}] ✅ Direct CDN download successful (${Math.round(stats.size / 1024)}KB)`);
  return outputPath;
}

/**
 * Method 1: Download using yt-dlp (with or without cookies)
 * 
 * Performance Optimization PRD Section 4.2.4:
 * - Lower resolution to 360p (50% smaller files)
 * - Download first 30 seconds only
 */
async function downloadViaYtDlp(url: string, id: string, useCookies: boolean): Promise<string> {
  const tempDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    // Create cache/config subdirectories for yt-dlp
    fs.mkdirSync(path.join(tempDir, '.cache'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.config'), { recursive: true });
  }

  const safeId = sanitizeId(id);
  const outputPath = path.join(tempDir, `${safeId}.mp4`);

  // Clean up existing file before download to prevent resume errors
  if (fs.existsSync(outputPath)) {
    try {
      fs.unlinkSync(outputPath);
      logger.info(`[${id}] Deleted existing file: ${outputPath}`);
    } catch (err: any) {
      logger.warn(`[${id}] Failed to delete existing file: ${err.message}`);
    }
  }

  const ytDlpOptions: any = {
    output: outputPath,
    // Performance Optimization PRD Section 4.2.4: Lower resolution for faster download
    format: 'worst[height<=360][ext=mp4]/worst[ext=mp4]', // Prefer 360p, fallback to worst
    maxFilesize: '50M',
    matchFilter: `duration <= ${MAX_DURATION_SEC}`,
    noPlaylist: true,
    noPart: true, // Prevent .part files on interrupted downloads (fixes HTTP 416)
    noMtime: true, // Prevent filesystem timestamp errors (fixes permission errors)
    noCacheDir: true, // Prevent writing to cache folder (fixes read-only errors)
    retries: 1, // Reduced retries - circuit breaker handles failure protection
    fragmentRetries: 1,
    skipUnavailableFragments: true,
    // Performance Optimization: Download first 30s only - DISABLED (requires ffmpeg)
    // downloadSections: '*0-30', // Commented out - requires ffmpeg installation
    // Speed optimizations
    // Note: concurrentFragmentDownloads removed - not supported in this yt-dlp version
    noCheckCertificate: true, // Skip SSL verification for speed
  };

  // Copy cookies to writable temp location if requested (yt-dlp writes back to cookie file)
  let tempCookiePath: string | null = null;
  const cookiesPath = getCookiesPath();

  if (useCookies && fs.existsSync(cookiesPath)) {
    tempCookiePath = path.join(tempDir, `${safeId}_cookies.txt`);
    try {
      await fsPromises.copyFile(cookiesPath, tempCookiePath);
      ytDlpOptions.cookies = tempCookiePath;
      logger.info(`[${id}] Using temp cookies at: ${tempCookiePath}`);
    } catch (err: any) {
      logger.warn(`[${id}] Failed to copy cookies: ${err.message}`);
      tempCookiePath = null; // Reset so we don't try to delete non-existent file
    }
  } else if (useCookies) {
    logger.warn(`[${id}] Cookies file not found at: ${cookiesPath}`);
  }

  try {
    const execOptions: any = {};
    if (YTDLP_BINARY_PATH) {
      execOptions.execPath = YTDLP_BINARY_PATH;
    }
    
    await ytDlpExec(url, ytDlpOptions, execOptions);

    if (!fs.existsSync(outputPath)) {
      throw new Error('yt-dlp did not create output file');
    }

    return outputPath;
  } catch (error: any) {
    logger.error(`[${id}] yt-dlp execution failed: ${error.message}`);
    if (error.message?.includes('not found') || error.message?.includes('ENOENT')) {
      throw new Error('yt-dlp binary not found. Please install yt-dlp or check PATH configuration.');
    }
    throw error;
  } finally {
    // Clean up temp cookie file (regardless of success or failure)
    if (tempCookiePath) {
      await fsPromises.unlink(tempCookiePath).catch(() => {
        // Silently ignore cleanup errors
      });
    }
  }
}

/**
 * Method 2: Download using Cobalt.tools API (no authentication needed)
 */
async function downloadViaCobalt(url: string, id: string): Promise<string> {
  const tempDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    // Create cache/config subdirectories for consistency
    fs.mkdirSync(path.join(tempDir, '.cache'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.config'), { recursive: true });
  }

  const safeId = sanitizeId(id);
  const outputPath = path.join(tempDir, `${safeId}.mp4`);

  // Clean up existing file before download to prevent conflicts
  if (fs.existsSync(outputPath)) {
    try {
      fs.unlinkSync(outputPath);
      logger.info(`[${id}] Deleted existing file: ${outputPath}`);
    } catch (err: any) {
      logger.warn(`[${id}] Failed to delete existing file: ${err.message}`);
    }
  }

  // Step 1: Get download URL from Cobalt API
  const apiResponse = await axios.post(
    'https://api.cobalt.tools/api/json',
    {
      url: url,
      vCodec: 'h264',
      vQuality: '480',
      isAudioOnly: false,
      filenamePattern: 'basic',
    },
    {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  if (apiResponse.data.status !== 'redirect' && apiResponse.data.status !== 'stream') {
    throw new Error(`Cobalt API error: ${apiResponse.data.text || 'Failed to get download URL'}`);
  }

  const downloadUrl = apiResponse.data.url;

  // Step 2: Download the video file
  const videoResponse = await axios({
    method: 'GET',
    url: downloadUrl,
    responseType: 'stream',
    timeout: 60000,
  });

  await pipeline(videoResponse.data, fs.createWriteStream(outputPath));

  if (!fs.existsSync(outputPath)) {
    throw new Error('Cobalt download did not create output file');
  }

  return outputPath;
}

/**
 * MAIN EXPORT: Hybrid downloader with 4-tier fallback cascade
 * 
 * Performance Optimization PRD Section 4.3 - Cascade Architecture:
 * Priority: Direct CDN (2-4s) → yt-dlp (cookies) → Cobalt API → yt-dlp (no cookies)
 * 
 * Protected by circuit breaker to prevent excessive retries when Instagram is blocking
 */
export async function downloadReel(url: string, id: string): Promise<string> {
  // Wrap the download logic with circuit breaker protection
  return withCircuitBreaker('instagram-download', () => downloadReelInternal(url, id));
}

/**
 * Internal download function - called by circuit breaker
 */
async function downloadReelInternal(url: string, id: string): Promise<string> {
  const tempDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    // Create cache/config subdirectories for yt-dlp
    fs.mkdirSync(path.join(tempDir, '.cache'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.config'), { recursive: true });
  }

  // SECURITY: Sanitize ID to prevent path traversal
  const safeId = sanitizeId(id);
  if (!safeId) {
    throw new Error('Invalid request ID');
  }

  logger.info(`[${id}] Starting download: ${url}`);

  // Build fallback cascade per Performance PRD Section 4.3
  const methods: Array<{ name: string; fn: () => Promise<string> }> = [];
  const cookiesPath = getCookiesPath();

  // TIER 1: Direct CDN extraction (FASTEST - 2-4s, 95% success)
  // Performance Optimization PRD Section 4.2.1
  methods.push({
    name: 'direct-cdn',
    fn: () => downloadViaDirectCDN(url, id),
  });

  // TIER 2: yt-dlp with cookies (highest reliability for private content, 5-10s)
  if (fs.existsSync(cookiesPath)) {
    methods.push({
      name: 'yt-dlp-cookies',
      fn: () => downloadViaYtDlp(url, id, true),
    });
  } else {
    logger.warn(`[${id}] Cookies file not found at: ${cookiesPath}, skipping cookie-based download`);
  }

  // TIER 3: Cobalt API (cookie-less, good for public content, 6-10s)
  methods.push({
    name: 'cobalt-api',
    fn: () => downloadViaCobalt(url, id),
  });

  // TIER 4: yt-dlp without cookies (last resort, 5-10s)
  methods.push({
    name: 'yt-dlp-no-cookies',
    fn: () => downloadViaYtDlp(url, id, false),
  });

  let lastError: Error | null = null;

  // Try each method in sequence until one succeeds
  for (const method of methods) {
    try {
      logger.info(`[${id}] Attempting: ${method.name}`);
      const result = await method.fn();
      logger.info(`[${id}] ✅ Success via ${method.name}`);
      return result;
    } catch (error: any) {
      logger.warn(`[${id}] ❌ ${method.name} failed: ${error.message}`);
      lastError = error;

      // Get error details for decision making
      const stderr = error.stderr || error.message || '';

      // Check for duration filter rejection (terminal error - don't retry)
      if (stderr.includes('does not pass filter') && stderr.includes('duration')) {
        logger.error(`[${id}] Video exceeds max duration (${MAX_DURATION_SEC}s) - not retrying`);
        throw new Error('Video too long (max 5 minutes)');
      }

      // Check for authentication/rate-limit errors (continue to next method)
      if (
        stderr.includes('login required') ||
        stderr.includes('rate-limit') ||
        stderr.includes('Requested content is not available') ||
        error.response?.status === 429
      ) {
        logger.warn(`[${id}] Auth/rate-limit issue detected, trying next method`);
        continue;
      }

      // For other errors, continue to next method
      continue;
    }
  }

  // All methods exhausted
  logger.error(`[${id}] All download methods failed`);
  throw new Error(`All download methods exhausted. Last error: ${lastError?.message}`);
}

