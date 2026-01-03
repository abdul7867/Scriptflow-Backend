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
 * 
 * @deprecated Use generateRequestHashV2 for new implementations
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

/**
 * Tier 2 Cache Key V2: Hash with variation support
 * 
 * ScriptFlow 2.0 - Each variation gets a unique hash
 * Same user + reel + idea with variationIndex=0, 1, 2... produces different hashes
 * This allows fresh generation on each "redo" request
 * 
 * @param manychatUserId - ManyChat subscriber ID
 * @param reelUrl - Instagram reel URL
 * @param userIdea - User's idea text
 * @param variationIndex - Which variation (0 = first, 1 = first redo, etc.)
 * @param mode - Generation mode (full or hook_only)
 */
export function generateRequestHashV2(
  manychatUserId: string, 
  reelUrl: string, 
  userIdea: string,
  variationIndex: number = 0,
  mode: string = 'full'
): string {
  const normalizedUrl = normalizeInstagramUrl(reelUrl);
  const normalizedIdea = userIdea.toLowerCase().trim();
  const genMode = mode?.trim() || 'full';
  
  // Include variationIndex in hash - this makes each variation unique
  const data = `v2:${manychatUserId}:${normalizedUrl}:${normalizedIdea}:${variationIndex}:${genMode}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a short variation tag for display
 * e.g., "v1", "v2", "v3"
 */
export function getVariationTag(variationIndex: number): string {
  return `v${variationIndex + 1}`;
}

/**
 * Extract reel ID from Instagram URL
 * Useful for shorter cache keys or display
 */
export function extractReelId(url: string): string | null {
  try {
    const normalized = normalizeInstagramUrl(url);
    const match = normalized.match(/\/reel\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
