import crypto from 'crypto';

/**
 * Normalize Instagram URL for consistent caching
 * - Removes UTM parameters and other tracking params
 * - Removes trailing slashes
 * - Extracts just the core reel ID path
 */
export function normalizeInstagramUrl(url: string): string {
  try {
    const parsed = new URL(url);
    
    // Remove all query parameters (UTM, igsh, etc.)
    parsed.search = '';
    
    // Normalize the pathname
    let pathname = parsed.pathname;
    
    // Remove trailing slash
    if (pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    
    // Normalize /reels/ to /reel/
    pathname = pathname.replace('/reels/', '/reel/');
    
    parsed.pathname = pathname;
    
    return parsed.toString();
  } catch {
    // If URL parsing fails, return as-is
    return url;
  }
}

/**
 * Tier 1 Cache Key: Hash based ONLY on normalized reel URL
 * Used to cache video analysis (the expensive part)
 */
export function generateReelHash(reelUrl: string): string {
  const normalizedUrl = normalizeInstagramUrl(reelUrl);
  return crypto.createHash('sha256').update(normalizedUrl).digest('hex');
}

/**
 * Tier 2 Cache Key: Hash based on ALL parameters
 * Used to cache final scripts (includes idea, language, tone, mode)
 */
export function generateRequestHash(
  manychatUserId: string, 
  reelUrl: string, 
  userIdea: string,
  languageHint?: string,
  toneHint?: string,
  mode?: string
): string {
  // Normalize URL and optional params
  const normalizedUrl = normalizeInstagramUrl(reelUrl);
  const lang = languageHint?.trim() || 'default';
  const tone = toneHint?.trim() || 'default';
  const genMode = mode?.trim() || 'full';
  
  const data = `${manychatUserId}-${normalizedUrl}-${userIdea}-${lang}-${tone}-${genMode}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}
