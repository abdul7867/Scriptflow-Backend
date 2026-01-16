/**
 * MicroCache - Ultra-lightweight LRU cache for t3.micro (1GB RAM) environment
 * 
 * Memory budget: 100 items × ~1KB avg = ~100KB max
 * TTL: 2 minutes default (aggressive to prevent stale data)
 * 
 * @see implementation_plan.md - Component 1
 */

import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/** Maximum number of items in L1 cache (memory protection) */
const L1_MAX_ITEMS = 100;

/** Default TTL in milliseconds (2 minutes) */
const L1_DEFAULT_TTL_MS = 2 * 60 * 1000;

/** Memory warning threshold (50MB) */
const MEMORY_WARNING_THRESHOLD_MB = 50;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface CacheEntry<T = any> {
    value: T;
    expiry: number;
    size: number;  // Approximate size in bytes
}

interface CacheStats {
    hits: number;
    misses: number;
    evictions: number;
    itemCount: number;
    approximateSizeKB: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// MICRO CACHE CLASS
// ═══════════════════════════════════════════════════════════════════════════

class MicroCache {
    private cache = new Map<string, CacheEntry>();
    private stats: CacheStats = {
        hits: 0,
        misses: 0,
        evictions: 0,
        itemCount: 0,
        approximateSizeKB: 0,
    };
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        // Cleanup expired entries every 30 seconds
        this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
    }

    /**
     * Get item from cache
     * Returns null if not found or expired
     */
    get<T>(key: string): T | null {
        const entry = this.cache.get(key);

        if (!entry) {
            this.stats.misses++;
            return null;
        }

        if (Date.now() > entry.expiry) {
            // Expired - remove and return null
            this.cache.delete(key);
            this.stats.misses++;
            this.updateSizeStats();
            return null;
        }

        // Move to end of Map for LRU (Map maintains insertion order)
        this.cache.delete(key);
        this.cache.set(key, entry);

        this.stats.hits++;
        return entry.value as T;
    }

    /**
     * Set item in cache with optional TTL
     */
    set(key: string, value: any, ttlMs: number = L1_DEFAULT_TTL_MS): void {
        // Enforce max items limit (LRU eviction)
        this.enforceLimit();

        const size = this.estimateSize(value);

        this.cache.set(key, {
            value,
            expiry: Date.now() + ttlMs,
            size,
        });

        this.updateSizeStats();
        this.checkMemoryUsage();
    }

    /**
     * Delete item from cache
     */
    delete(key: string): boolean {
        const deleted = this.cache.delete(key);
        if (deleted) {
            this.updateSizeStats();
        }
        return deleted;
    }

    /**
     * Check if key exists and is not expired
     */
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;
        if (Date.now() > entry.expiry) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }

    /**
     * Get or set with callback (cache-aside pattern)
     */
    async getOrSet<T>(
        key: string,
        fetchFn: () => Promise<T>,
        ttlMs: number = L1_DEFAULT_TTL_MS
    ): Promise<T> {
        const cached = this.get<T>(key);
        if (cached !== null) {
            return cached;
        }

        const value = await fetchFn();
        this.set(key, value, ttlMs);
        return value;
    }

    /**
     * Clear all items
     */
    clear(): void {
        this.cache.clear();
        this.updateSizeStats();
        logger.debug('MicroCache: Cleared all items');
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        return {
            ...this.stats,
            itemCount: this.cache.size,
        };
    }

    /**
     * Get hit rate percentage
     */
    getHitRate(): number {
        const total = this.stats.hits + this.stats.misses;
        if (total === 0) return 0;
        return Math.round((this.stats.hits / total) * 100);
    }

    /**
     * Stop the cache (cleanup interval)
     */
    stop(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE METHODS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Enforce max items limit using LRU eviction
     * Evicts oldest entries (first in Map) when at capacity
     */
    private enforceLimit(): void {
        while (this.cache.size >= L1_MAX_ITEMS) {
            // Map.keys().next() gives the oldest entry (LRU)
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
                this.stats.evictions++;
            } else {
                break;
            }
        }
    }

    /**
     * Remove expired entries
     */
    private cleanup(): void {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, entry] of this.cache) {
            if (entry.expiry < now) {
                this.cache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.updateSizeStats();
            logger.debug(`MicroCache: Cleaned ${cleaned} expired entries`);
        }
    }

    /**
     * Estimate size of a value in bytes
     */
    private estimateSize(value: any): number {
        try {
            const str = JSON.stringify(value);
            return str.length * 2; // UTF-16 chars are 2 bytes
        } catch {
            return 1024; // Default 1KB if can't stringify
        }
    }

    /**
     * Update size statistics
     */
    private updateSizeStats(): void {
        let totalBytes = 0;
        for (const entry of this.cache.values()) {
            totalBytes += entry.size;
        }
        this.stats.approximateSizeKB = Math.round(totalBytes / 1024);
        this.stats.itemCount = this.cache.size;
    }

    /**
     * Check memory usage and warn if high
     */
    private checkMemoryUsage(): void {
        if (this.stats.approximateSizeKB > MEMORY_WARNING_THRESHOLD_MB * 1024) {
            logger.warn(`MicroCache: Memory usage high (${this.stats.approximateSizeKB}KB)`);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SPECIALIZED CACHE INSTANCES
// ═══════════════════════════════════════════════════════════════════════════

/** Session cache - for hot user sessions (100 items, 2 min TTL) */
export const sessionCache = new MicroCache();

/** Rate limit cache - for known under-limit users (30s TTL) */
class RateLimitCache extends MicroCache {
    isKnownUnderLimit(subscriberId: string, limit: number): boolean {
        const count = this.get<number>(`rl:${subscriberId}`);
        return count !== null && count < limit;
    }

    updateCount(subscriberId: string, count: number, ttlMs: number = 30000): void {
        this.set(`rl:${subscriberId}`, count, ttlMs);
    }
}

export const rateLimitCache = new RateLimitCache();

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { MicroCache };
export default sessionCache;
