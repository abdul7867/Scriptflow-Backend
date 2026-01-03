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

import { logger } from '../utils/logger';
import { getRedis } from '../queue/redis';

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
      const redis = getRedis();
      const key = getSessionKey(subscriberId);
      
      const data = await redis.get(key);
      
      if (!data) {
        logger.debug('Session not found, creating empty', { subscriberId });
        return createEmptySession();
      }
      
      const session = JSON.parse(data) as SessionContext;
      
      logger.debug('Session retrieved', { 
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
   * Automatically updates lastActivityAt and refreshes TTL
   */
  async updateSession(
    subscriberId: string, 
    updates: Partial<SessionContext>
  ): Promise<void> {
    try {
      const redis = getRedis();
      const key = getSessionKey(subscriberId);
      
      // Get existing session
      const existing = await this.getSession(subscriberId);
      
      // Merge updates
      const updated: SessionContext = {
        ...existing,
        ...updates,
        lastActivityAt: new Date().toISOString(),
      };
      
      // Save with TTL
      await redis.setex(key, SESSION_TTL_SECONDS, JSON.stringify(updated));
      
      logger.debug('Session updated', { 
        subscriberId, 
        updates: Object.keys(updates),
        newState: updated.conversationState,
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
