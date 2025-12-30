import ytDlpExec from 'yt-dlp-exec';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import stream from 'stream';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const pipeline = promisify(stream.pipeline);

// Max duration to process (to avoid huge files)
const MAX_DURATION_SEC = 300; // 5 minutes

// Fixed paths for Docker deployment
const COOKIES_PATH = '/app/cookies/instagram_cookies.txt';
const YTDLP_BINARY_PATH = '/usr/local/bin/yt-dlp';

/**
 * Sanitize ID to prevent path traversal attacks
 * SECURITY: Removes any characters that could be used to escape the temp directory
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-_]/g, '');
}

/**
 * Method 1: Download using yt-dlp (with or without cookies)
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
    format: 'worst[ext=mp4]',
    maxFilesize: '50M',
    matchFilter: `duration <= ${MAX_DURATION_SEC}`,
    noPlaylist: true,
    noPart: true, // Prevent .part files on interrupted downloads (fixes HTTP 416)
    noMtime: true, // Prevent filesystem timestamp errors (fixes permission errors)
    noCacheDir: true, // Prevent writing to cache folder (fixes read-only errors)
    retries: 3, // Auto-retry on transient failures
    fragmentRetries: 3,
    skipUnavailableFragments: true,
  };

  // Add cookies if requested and available (with error handling)
  if (useCookies) {
    if (fs.existsSync(COOKIES_PATH)) {
      ytDlpOptions.cookies = COOKIES_PATH;
      logger.info(`[${id}] Using cookies from: ${COOKIES_PATH}`);
    } else {
      logger.warn(`[${id}] Cookies file not found at: ${COOKIES_PATH}`);
    }
  }

  await ytDlpExec(url, ytDlpOptions, { execPath: YTDLP_BINARY_PATH });

  if (!fs.existsSync(outputPath)) {
    throw new Error('yt-dlp did not create output file');
  }

  return outputPath;
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
 * MAIN EXPORT: Hybrid downloader with 3-tier fallback cascade
 * Priority: yt-dlp (cookies) → Cobalt API → yt-dlp (no cookies)
 */
export async function downloadReel(url: string, id: string): Promise<string> {
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

  // Build fallback cascade
  const methods: Array<{ name: string; fn: () => Promise<string> }> = [];

  // Method 1: yt-dlp with cookies (highest reliability for private content)
  if (fs.existsSync(COOKIES_PATH)) {
    methods.push({
      name: 'yt-dlp-cookies',
      fn: () => downloadViaYtDlp(url, id, true),
    });
  }

  // Method 2: Cobalt API (cookie-less, good for public content)
  methods.push({
    name: 'cobalt-api',
    fn: () => downloadViaCobalt(url, id),
  });

  // Method 3: yt-dlp without cookies (last resort)
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

