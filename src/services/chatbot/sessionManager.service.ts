/**
 * Session Manager - Redis-based context memory for conversation state
 * 
 * Enables:
 * - "Redo" detection without user re-sending reel URL
 * - Variation tracking for fresh content on each request
 * - Multi-turn conversation flow (reel → prompt → idea → script)
 * 
 * TTL: 30 minutes (refreshed on activity)
 */

import { logger } from '../../utils/logger';
import { getRedis } from '../../queue/redis';
import { sessionCache } from '../cache.service';
import { luaScripts } from '../../queue/luaScripts';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ConversationState =
  | 'idle'              // No active conversation
  | 'awaiting_idea'     // Sent reel, waiting for user's idea
  | 'awaiting_confirm'  // Showed script, waiting for feedback
  | 'processing';       // Currently generating script

export interface SessionContext {
  /** Last reel URL the user sent */
  lastReelUrl: string | null;

  /** Last user idea (or default) used */
  lastUserIdea: string | null;

  /** Request hash of last generation (for feedback linking) */
  lastRequestHash: string | null;

  /** Script ID of last generation (for feedback linking) */
  lastScriptId: string | null;

  /** How many variations have been generated for current reel+idea */
  variationCount: number;

  /** Current conversation flow state */
  conversationState: ConversationState;

  /** When this session was last active */
  lastActivityAt: string; // ISO date string

  /** Job ID if currently processing */
  activeJobId: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Session TTL in seconds (30 minutes) */
const SESSION_TTL_SECONDS = 30 * 60;

/** Soft limit - after this many variations, we warn user but still allow more */
const SOFT_VARIATION_LIMIT = 5;

/** Redis key prefix for sessions */
const SESSION_KEY_PREFIX = 'session:';

/** Redis key prefix for variation counts */
const VARIATION_KEY_PREFIX = 'variation:';

/**
 * In-memory TTL cache to avoid redis.ttl() calls
 * Key: session key, Value: last refresh timestamp (ms)
 * OPTIMIZATION: Reduces Redis reads by ~33% per session update
 */
const sessionTTLCache = new Map<string, number>();

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate session key for Redis
 */
function getSessionKey(subscriberId: string): string {
  return `${SESSION_KEY_PREFIX}${subscriberId}`;
}

/**
 * Generate variation count key for Redis
 * Key is unique per user + reel + idea combination
 */
function getVariationKey(subscriberId: string, reelUrl: string, userIdea: string): string {
  const normalizedIdea = userIdea.toLowerCase().trim().substring(0, 100);
  return `${VARIATION_KEY_PREFIX}${subscriberId}:${reelUrl}:${normalizedIdea}`;
}

/**
 * Create empty session
 */
function createEmptySession(): SessionContext {
  return {
    lastReelUrl: null,
    lastUserIdea: null,
    lastRequestHash: null,
    lastScriptId: null,
    variationCount: 0,
    conversationState: 'idle',
    lastActivityAt: new Date().toISOString(),
    activeJobId: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSION MANAGER CLASS
// ═══════════════════════════════════════════════════════════════════════════

class SessionManager {

  /**
   * Get session for a subscriber
   * Creates empty session if not exists
   */
  async getSession(subscriberId: string): Promise<SessionContext> {
    try {
      const key = getSessionKey(subscriberId);

      // L1 Cache: Check in-memory first (reduces Redis calls by ~80%)
      const cached = sessionCache.get<SessionContext>(key);
      if (cached) {
        logger.debug('Session L1 cache hit', { subscriberId });
        return cached;
      }

      // L2 Cache: Redis with auto TTL refresh via Lua script
      const refreshThreshold = Math.floor(SESSION_TTL_SECONDS * 0.2); // Refresh if < 20% TTL remaining
      const data = await luaScripts.getSessionWithRefresh(
        key,
        SESSION_TTL_SECONDS,
        refreshThreshold
      );

      if (!data) {
        logger.debug('Session not found, creating empty', { subscriberId });
        return createEmptySession();
      }

      const session = JSON.parse(data) as SessionContext;

      // Populate L1 cache for future reads
      sessionCache.set(key, session, SESSION_TTL_SECONDS * 1000 / 2); // L1 TTL = 50% of Redis TTL

      logger.debug('Session retrieved (L2 hit)', {
        subscriberId,
        state: session.conversationState,
        hasReel: !!session.lastReelUrl,
      });

      return session;
    } catch (error) {
      logger.error('Failed to get session', { subscriberId, error });
      return createEmptySession();
    }
  }

  /**
   * Update session with new data
   * Automatically updates lastActivityAt
   * 
   * OPTIMIZED: Uses in-memory TTL cache to skip redis.ttl() calls
   * This reduces Redis reads by ~33% per session update
   */
  async updateSession(
    subscriberId: string,
    updates: Partial<SessionContext>
  ): Promise<void> {
    try {
      const key = getSessionKey(subscriberId);
      const now = Date.now();

      // Get existing from L1 cache first, fallback to Redis
      let existing: SessionContext = sessionCache.get<SessionContext>(key) || createEmptySession();
      const cached = sessionCache.has(key);
      if (!cached) {
        const redis = getRedis();
        const existingData = await redis.get(key);
        if (existingData) {
          existing = JSON.parse(existingData) as SessionContext;
        }
      }

      // Merge updates
      const updated: SessionContext = {
        ...existing,
        ...updates,
        lastActivityAt: new Date().toISOString(),
      };

      // Update L1 cache immediately (write-through)
      sessionCache.set(key, updated, SESSION_TTL_SECONDS * 1000 / 2);

      // OPTIMIZED: Check if Redis write is needed based on TTL cache
      const lastRefresh = sessionTTLCache.get(key) || 0;
      const ttl80PercentMs = (SESSION_TTL_SECONDS * 1000) * 0.8; // 80% threshold (24 min)
      const shouldRefreshTTL = (now - lastRefresh) > ttl80PercentMs;

      if (shouldRefreshTTL) {
        // Use Lua script for atomic update with TTL refresh
        await luaScripts.updateSession(key, JSON.stringify(updated), SESSION_TTL_SECONDS);
        sessionTTLCache.set(key, now);
      } else {
        // Just update data without TTL refresh
        const redis = getRedis();
        await redis.set(key, JSON.stringify(updated), 'KEEPTTL');
      }

      logger.debug('Session updated', {
        subscriberId,
        updates: Object.keys(updates),
        newState: updated.conversationState,
        ttlRefreshed: shouldRefreshTTL,
      });
    } catch (error) {
      logger.error('Failed to update session', { subscriberId, updates, error });
    }
  }

  /**
   * Set conversation state
   */
  async setState(subscriberId: string, state: ConversationState): Promise<void> {
    await this.updateSession(subscriberId, { conversationState: state });
  }

  /**
   * Store reel URL when user sends it
   */
  async setReelUrl(subscriberId: string, reelUrl: string): Promise<void> {
    await this.updateSession(subscriberId, {
      lastReelUrl: reelUrl,
      conversationState: 'awaiting_idea',
      // Reset variation count for new reel
      variationCount: 0,
    });
  }

  /**
   * Store user idea and prepare for generation
   */
  async setUserIdea(subscriberId: string, userIdea: string): Promise<void> {
    const session = await this.getSession(subscriberId);

    // If same idea as last time, this might be a redo
    const isSameIdea = session.lastUserIdea?.toLowerCase().trim() ===
      userIdea.toLowerCase().trim();

    await this.updateSession(subscriberId, {
      lastUserIdea: userIdea,
      conversationState: 'processing',
      // Increment variation if same idea
      variationCount: isSameIdea ? session.variationCount + 1 : 0,
    });
  }

  /**
   * Store generation result for feedback linking
   */
  async setGenerationResult(
    subscriberId: string,
    requestHash: string,
    scriptId: string
  ): Promise<void> {
    await this.updateSession(subscriberId, {
      lastRequestHash: requestHash,
      lastScriptId: scriptId,
      conversationState: 'awaiting_confirm',
    });
  }

  /**
   * Set active job ID when processing starts
   */
  async setActiveJob(subscriberId: string, jobId: string): Promise<void> {
    await this.updateSession(subscriberId, {
      activeJobId: jobId,
      conversationState: 'processing',
    });
  }

  /**
   * Clear active job when processing completes
   */
  async clearActiveJob(subscriberId: string): Promise<void> {
    await this.updateSession(subscriberId, {
      activeJobId: null,
    });
  }

  /**
   * Get and increment variation count for a specific reel+idea combo
   * This persists longer than session (for returning users)
   * Now allows unlimited variations but warns after soft limit
   */
  async getAndIncrementVariation(
    subscriberId: string,
    reelUrl: string,
    userIdea: string
  ): Promise<{ variationIndex: number; isMaxReached: boolean; isSoftLimitReached: boolean; totalVariations: number }> {
    try {
      const redis = getRedis();
      const key = getVariationKey(subscriberId, reelUrl, userIdea);

      // Increment and get new value
      const newCount = await redis.incr(key);

      // Set TTL (7 days for variation tracking)
      await redis.expire(key, 7 * 24 * 60 * 60);

      // Variation index is 0-based (first generation is index 0)
      const variationIndex = newCount - 1;
      // Soft limit reached but we allow unlimited - just warn
      const isSoftLimitReached = newCount > SOFT_VARIATION_LIMIT;
      // isMaxReached kept for backwards compat but now always false (no hard limit)
      const isMaxReached = false;

      logger.debug('Variation count updated', {
        subscriberId,
        reelUrl: reelUrl.substring(0, 50),
        variationIndex,
        isSoftLimitReached,
        totalVariations: newCount,
      });

      return { variationIndex, isMaxReached, isSoftLimitReached, totalVariations: newCount };
    } catch (error) {
      logger.error('Failed to get variation count', { subscriberId, error });
      return { variationIndex: 0, isMaxReached: false, isSoftLimitReached: false, totalVariations: 0 };
    }
  }

  /**
   * Get current variation count without incrementing
   */
  async getVariationCount(
    subscriberId: string,
    reelUrl: string,
    userIdea: string
  ): Promise<number> {
    try {
      const redis = getRedis();
      const key = getVariationKey(subscriberId, reelUrl, userIdea);

      const count = await redis.get(key);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      logger.error('Failed to get variation count', { subscriberId, error });
      return 0;
    }
  }

  /**
   * Reset variation count for a reel+idea combo
   */
  async resetVariation(
    subscriberId: string,
    reelUrl: string,
    userIdea: string
  ): Promise<void> {
    try {
      const redis = getRedis();
      const key = getVariationKey(subscriberId, reelUrl, userIdea);

      await redis.del(key);

      logger.debug('Variation count reset', { subscriberId, reelUrl: reelUrl.substring(0, 50) });
    } catch (error) {
      logger.error('Failed to reset variation', { subscriberId, error });
    }
  }

  /**
   * Clear session completely
   */
  async clearSession(subscriberId: string): Promise<void> {
    try {
      const redis = getRedis();
      const key = getSessionKey(subscriberId);

      await redis.del(key);

      logger.debug('Session cleared', { subscriberId });
    } catch (error) {
      logger.error('Failed to clear session', { subscriberId, error });
    }
  }

  /**
   * Check if session is expired (no activity in TTL period)
   */
  async isSessionActive(subscriberId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const key = getSessionKey(subscriberId);

      const ttl = await redis.ttl(key);
      return ttl > 0;
    } catch (error) {
      logger.error('Failed to check session TTL', { subscriberId, error });
      return false;
    }
  }

  /**
   * Get session info for debugging/admin
   */
  async getSessionInfo(subscriberId: string): Promise<{
    exists: boolean;
    ttlSeconds: number;
    context: SessionContext | null;
  }> {
    try {
      const redis = getRedis();
      const key = getSessionKey(subscriberId);

      const [data, ttl] = await Promise.all([
        redis.get(key),
        redis.ttl(key),
      ]);

      return {
        exists: !!data,
        ttlSeconds: ttl,
        context: data ? JSON.parse(data) : null,
      };
    } catch (error) {
      logger.error('Failed to get session info', { subscriberId, error });
      return { exists: false, ttlSeconds: 0, context: null };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

/** Session state type alias for backwards compatibility */
export type SessionState = ConversationState;

/** Singleton session manager instance */
export const sessionManager = new SessionManager();

/** Export class for type usage */
export { SessionManager };

export default sessionManager;
