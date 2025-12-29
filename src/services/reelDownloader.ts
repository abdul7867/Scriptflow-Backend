import ytDlpExec from 'yt-dlp-exec';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

// Max duration to process (to avoid huge files)
const MAX_DURATION_SEC = 300; // 5 minutes

// Fixed paths for Docker deployment
const COOKIES_PATH = '/app/instagram_cookies.txt';
const YTDLP_BINARY_PATH = '/usr/local/bin/yt-dlp';

/**
 * Sanitize ID to prevent path traversal attacks
 * SECURITY: Removes any characters that could be used to escape the temp directory
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-_]/g, '');
}

export async function downloadReel(url: string, id: string): Promise<string> {
  const tempDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

  // SECURITY: Sanitize ID to prevent path traversal (e.g., '../../../etc/passwd')
  const safeId = sanitizeId(id);
  if (!safeId) {
    throw new Error('Invalid request ID');
  }
  
  const outputPath = path.join(tempDir, `${safeId}.mp4`);

  logger.info(`Downloading reel: ${url} to ${outputPath}`);

  try {
    // Build yt-dlp options
    const ytDlpOptions: any = {
      output: outputPath,
      format: 'worst[ext=mp4]', // Lowest quality mp4 is fine for audio extraction
      maxFilesize: '50M',
      matchFilter: `duration <= ${MAX_DURATION_SEC}`,
      noPlaylist: true,
    };

    // Add cookies if available (required for Instagram authentication)
    if (fs.existsSync(COOKIES_PATH)) {
      ytDlpOptions.cookies = COOKIES_PATH;
      logger.info(`Using Instagram cookies from: ${COOKIES_PATH}`);
    } else {
      logger.warn(`Cookies file not found at: ${COOKIES_PATH} - Instagram downloads may fail`);
    }

    // Execute yt-dlp with custom binary path
    await ytDlpExec(url, ytDlpOptions, { execPath: YTDLP_BINARY_PATH });

    // Check if file exists
    if (!fs.existsSync(outputPath)) {
        throw new Error('File was not created by yt-dlp');
    }

    return outputPath;
  } catch (error: any) {
    logger.error('Failed to download reel', error);
    
    // Get stderr which contains the actual error messages from yt-dlp
    const stderr = error.stderr || error.message || '';
    
    // Check for Instagram authentication/rate-limit errors
    if (stderr.includes('login required') || 
        stderr.includes('rate-limit reached') ||
        stderr.includes('Requested content is not available')) {
        throw new Error('Instagram login required - content unavailable');
    }
    
    // Check for duration filter rejection (actual match-filter output)
    // yt-dlp outputs: "does not pass filter duration <= 300"
    if (stderr.includes('does not pass filter') && stderr.includes('duration')) {
        throw new Error('Video too long (max 5 minutes)');
    }
    
    throw new Error(`Download failed: ${error.message}`);
  }
}

