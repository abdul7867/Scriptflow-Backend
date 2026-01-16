/**
 * Redis Lua Scripts - Atomic operations to reduce Redis round-trips
 * 
 * Each script combines multiple Redis commands into a single network call
 * Critical for reducing Upstash free tier credit usage
 * 
 * @see implementation_plan.md - Component 2
 */

import { getRedis } from './redis';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════════════
// LUA SCRIPT DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Atomic Rate Limit Check
 * Combines: INCR + EXPIRE (conditional) + TTL
 * Returns: [count, ttl]
 */
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local count = redis.call('INCR', key)
if count == 1 then
  redis.call('EXPIRE', key, window)
end
local ttl = redis.call('TTL', key)
return {count, ttl}
`;

/**
 * Atomic Session Get and Refresh TTL
 * Combines: GET + EXPIRE (conditional based on remaining TTL)
 * Returns: session data string or nil
 */
const SESSION_GET_REFRESH_SCRIPT = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local refresh_threshold = tonumber(ARGV[2])
local data = redis.call('GET', key)
if data then
  local remaining = redis.call('TTL', key)
  if remaining < refresh_threshold then
    redis.call('EXPIRE', key, ttl)
  end
end
return data
`;

/**
 * Atomic Session Update
 * Combines: GET (for merge) + SETEX
 * Returns: OK
 */
const SESSION_UPDATE_SCRIPT = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local new_data = ARGV[2]
redis.call('SETEX', key, ttl, new_data)
return 'OK'
`;

/**
 * Batch Get Multiple Keys
 * Combines: Multiple GET calls into MGET
 * Returns: array of values
 */
const BATCH_GET_SCRIPT = `
return redis.call('MGET', unpack(KEYS))
`;

/**
 * Variation Counter with Limit Check
 * Combines: INCR + EXPIRE + GET
 * Returns: [count, is_soft_limit_reached (0/1)]
 */
const VARIATION_COUNTER_SCRIPT = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local soft_limit = tonumber(ARGV[2])
local count = redis.call('INCR', key)
if count == 1 then
  redis.call('EXPIRE', key, ttl)
end
local is_soft_limit = 0
if count > soft_limit then
  is_soft_limit = 1
end
return {count, is_soft_limit}
`;

// ═══════════════════════════════════════════════════════════════════════════
// LUA SCRIPT EXECUTOR CLASS
// ═══════════════════════════════════════════════════════════════════════════

class LuaScripts {
    private scriptHashes: Map<string, string> = new Map();

    /**
     * Check rate limit atomically (3 commands → 1)
     * @returns { count, ttl, allowed }
     */
    async checkRateLimit(
        key: string,
        limit: number,
        windowSeconds: number
    ): Promise<{ count: number; ttl: number; allowed: boolean }> {
        try {
            const redis = getRedis();
            const result = await redis.eval(
                RATE_LIMIT_SCRIPT,
                1,
                key,
                limit.toString(),
                windowSeconds.toString()
            ) as [number, number];

            const [count, ttl] = result;
            return {
                count,
                ttl,
                allowed: count <= limit,
            };
        } catch (error) {
            logger.error('Lua rate limit script failed', { key, error });
            throw error;
        }
    }

    /**
     * Get session with auto TTL refresh (2-3 commands → 1)
     * @param refreshThreshold - Refresh TTL if remaining TTL < this value
     */
    async getSessionWithRefresh(
        key: string,
        ttlSeconds: number,
        refreshThreshold: number
    ): Promise<string | null> {
        try {
            const redis = getRedis();
            const result = await redis.eval(
                SESSION_GET_REFRESH_SCRIPT,
                1,
                key,
                ttlSeconds.toString(),
                refreshThreshold.toString()
            ) as string | null;

            return result;
        } catch (error) {
            logger.error('Lua session get script failed', { key, error });
            throw error;
        }
    }

    /**
     * Update session atomically
     */
    async updateSession(
        key: string,
        data: string,
        ttlSeconds: number
    ): Promise<void> {
        try {
            const redis = getRedis();
            await redis.eval(
                SESSION_UPDATE_SCRIPT,
                1,
                key,
                ttlSeconds.toString(),
                data
            );
        } catch (error) {
            logger.error('Lua session update script failed', { key, error });
            throw error;
        }
    }

    /**
     * Batch get multiple keys (N commands → 1)
     */
    async batchGet(keys: string[]): Promise<Map<string, string | null>> {
        if (keys.length === 0) {
            return new Map();
        }

        try {
            const redis = getRedis();
            const values = await redis.mget(...keys);

            const result = new Map<string, string | null>();
            keys.forEach((key, index) => {
                result.set(key, values[index]);
            });

            return result;
        } catch (error) {
            logger.error('Batch get failed', { keyCount: keys.length, error });
            throw error;
        }
    }

    /**
     * Increment variation counter with soft limit check (3 commands → 1)
     */
    async incrementVariation(
        key: string,
        ttlSeconds: number,
        softLimit: number = 5
    ): Promise<{ count: number; isSoftLimitReached: boolean }> {
        try {
            const redis = getRedis();
            const result = await redis.eval(
                VARIATION_COUNTER_SCRIPT,
                1,
                key,
                ttlSeconds.toString(),
                softLimit.toString()
            ) as [number, number];

            const [count, isSoftLimit] = result;
            return {
                count,
                isSoftLimitReached: isSoftLimit === 1,
            };
        } catch (error) {
            logger.error('Lua variation counter script failed', { key, error });
            throw error;
        }
    }

    /**
     * Pipeline multiple commands for batch operations
     * Use when you need multiple different operations
     */
    async pipeline(
        commands: Array<{ cmd: string; args: (string | number)[] }>
    ): Promise<any[]> {
        try {
            const redis = getRedis();
            const pipeline = redis.pipeline();

            for (const { cmd, args } of commands) {
                (pipeline as any)[cmd.toLowerCase()](...args);
            }

            const results = await pipeline.exec();
            return results?.map(([err, result]) => {
                if (err) throw err;
                return result;
            }) || [];
        } catch (error) {
            logger.error('Pipeline execution failed', { error });
            throw error;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

export const luaScripts = new LuaScripts();
export { LuaScripts };
export default luaScripts;
