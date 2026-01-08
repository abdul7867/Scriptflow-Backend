/**
 * Degradation Service - Graceful degradation for service failures
 * 
 * Provides fallback behaviors when external services fail:
 * - Redis: In-memory rate limiting and session fallback
 * - MongoDB: Return cached data, skip persistence
 * - Gemini API: Template scripts
 * - ManyChat: Queue for retry
 * 
 * @see PRD_System_Robustness_t3micro.txt Section 7
 */

import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ServiceState = 'normal' | 'degraded' | 'down';

export interface DegradationState {
    redis: ServiceState;
    mongodb: ServiceState;
    gemini: ServiceState;
    manychat: ServiceState;
}

export type ScriptType = 'educational' | 'entertaining' | 'promotional' | 'storytelling';

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE SCRIPTS (Fallback when Gemini is unavailable)
// ═══════════════════════════════════════════════════════════════════════════

const TEMPLATE_SCRIPTS: Record<ScriptType, string> = {
    educational: `[HOOK]
🎬 VISUAL: Close-up face, eye contact with camera
💬 SAY: "Here's something most people don't know about {topic}..."

[BODY]
🎬 VISUAL: B-roll or screen recording showing the concept
💬 SAY: "The key insight is {main_point}. Let me show you exactly how it works."

[CTA]
🎬 VISUAL: Back to face, confident expression
💬 SAY: "Follow for more tips like this!"

---
⚠️ Template script generated (AI temporarily unavailable)
💡 Customize the {placeholders} with your specific content`,

    entertaining: `[HOOK]
🎬 VISUAL: Reaction face or dramatic pause
💬 SAY: "Wait, you guys are actually doing it like that?!"

[BODY]
🎬 VISUAL: Demonstration or example
💬 SAY: "Here's what you should be doing instead..."

[CTA]
🎬 VISUAL: Engaging expression
💬 SAY: "Drop a comment if you want part 2!"

---
⚠️ Template script generated (AI temporarily unavailable)
💡 Customize based on your content style`,

    promotional: `[HOOK]
🎬 VISUAL: Product close-up or result shot
💬 SAY: "This changed everything for me..."

[BODY]
🎬 VISUAL: Before/after or demonstration
💬 SAY: "I've tried {alternatives}, but nothing worked until {solution}."

[CTA]
🎬 VISUAL: Product shot with call-to-action
💬 SAY: "Link in bio if you want to try it!"

---
⚠️ Template script generated (AI temporarily unavailable)
💡 Fill in {alternatives} and {solution} for your product`,

    storytelling: `[HOOK]
🎬 VISUAL: Dramatic moment or reaction shot
💬 SAY: "I couldn't believe what happened next..."

[BODY]
🎬 VISUAL: Story progression visuals
💬 SAY: "So there I was, {situation}, when suddenly {twist happened}."

[CTA]
🎬 VISUAL: Resolution or cliffhanger
💬 SAY: "Want to know how it ended? Follow for part 2!"

---
⚠️ Template script generated (AI temporarily unavailable)
💡 Replace {situation} and {twist} with your story`,
};

// ═══════════════════════════════════════════════════════════════════════════
// IN-MEMORY FALLBACK (When Redis is unavailable)
// ═══════════════════════════════════════════════════════════════════════════

interface RateLimitEntry {
    count: number;
    expiry: number;
}

interface SessionEntry {
    data: any;
    expiry: number;
}

class InMemoryFallback {
    private rateLimits: Map<string, RateLimitEntry> = new Map();
    private sessions: Map<string, SessionEntry> = new Map();
    private readonly maxSize = 1000; // Prevent memory leak
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        // Start cleanup interval
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Every minute
    }

    /**
     * Check rate limit (returns true if allowed, false if limited)
     */
    checkRateLimit(key: string, limit: number, windowMs: number): boolean {
        const now = Date.now();
        const entry = this.rateLimits.get(key);

        if (!entry || entry.expiry < now) {
            // First request or expired - create new entry
            this.rateLimits.set(key, { count: 1, expiry: now + windowMs });
            this.enforceMaxSize(this.rateLimits);
            return true;
        }

        if (entry.count >= limit) {
            // Rate limited
            return false;
        }

        // Increment count
        entry.count++;
        return true;
    }

    /**
     * Get remaining requests for a key
     */
    getRemainingRequests(key: string, limit: number): number {
        const entry = this.rateLimits.get(key);
        if (!entry || entry.expiry < Date.now()) {
            return limit;
        }
        return Math.max(0, limit - entry.count);
    }

    /**
     * Get session data
     */
    getSession(key: string): any | null {
        const entry = this.sessions.get(key);
        if (!entry || entry.expiry < Date.now()) {
            this.sessions.delete(key);
            return null;
        }
        return entry.data;
    }

    /**
     * Set session data
     */
    setSession(key: string, data: any, ttlMs: number): void {
        this.enforceMaxSize(this.sessions);
        this.sessions.set(key, {
            data,
            expiry: Date.now() + ttlMs,
        });
    }

    /**
     * Delete session
     */
    deleteSession(key: string): void {
        this.sessions.delete(key);
    }

    /**
     * Enforce max size by evicting oldest entries
     */
    private enforceMaxSize<T>(map: Map<string, T>): void {
        if (map.size >= this.maxSize) {
            // Delete first (oldest) entry
            const firstKey = map.keys().next().value;
            if (firstKey) {
                map.delete(firstKey);
            }
        }
    }

    /**
     * Cleanup expired entries
     */
    private cleanup(): void {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, entry] of this.rateLimits) {
            if (entry.expiry < now) {
                this.rateLimits.delete(key);
                cleaned++;
            }
        }

        for (const [key, entry] of this.sessions) {
            if (entry.expiry < now) {
                this.sessions.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            logger.debug(`InMemoryFallback: Cleaned ${cleaned} expired entries`);
        }
    }

    /**
     * Get stats for monitoring
     */
    getStats(): { rateLimits: number; sessions: number; maxSize: number } {
        return {
            rateLimits: this.rateLimits.size,
            sessions: this.sessions.size,
            maxSize: this.maxSize,
        };
    }

    /**
     * Clear all data
     */
    clear(): void {
        this.rateLimits.clear();
        this.sessions.clear();
        logger.info('InMemoryFallback: All data cleared');
    }

    /**
     * Stop the cleanup interval
     */
    stop(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// DEGRADATION SERVICE CLASS
// ═══════════════════════════════════════════════════════════════════════════

class DegradationService {
    private state: DegradationState = {
        redis: 'normal',
        mongodb: 'normal',
        gemini: 'normal',
        manychat: 'normal',
    };

    private inMemoryFallback: InMemoryFallback;

    constructor() {
        this.inMemoryFallback = new InMemoryFallback();
    }

    /**
     * Set a service's state
     */
    setServiceState(service: keyof DegradationState, state: ServiceState): void {
        if (this.state[service] !== state) {
            logger.warn(`Service ${service} state changed: ${this.state[service]} → ${state}`);
            this.state[service] = state;
        }
    }

    /**
     * Get current degradation state
     */
    getState(): DegradationState {
        return { ...this.state };
    }

    /**
     * Check if all services are operational
     */
    isFullyOperational(): boolean {
        return Object.values(this.state).every(s => s === 'normal');
    }

    /**
     * Check if a specific service is available
     */
    isServiceAvailable(service: keyof DegradationState): boolean {
        return this.state[service] !== 'down';
    }

    /**
     * Get a template script (fallback when Gemini is unavailable)
     */
    getTemplateScript(type: ScriptType = 'educational', context?: { topic?: string }): string {
        let template = TEMPLATE_SCRIPTS[type] || TEMPLATE_SCRIPTS.educational;

        // Replace placeholders if context provided
        if (context?.topic) {
            template = template.replace(/{topic}/g, context.topic);
        }

        return template;
    }

    /**
     * Get all available template types
     */
    getTemplateTypes(): ScriptType[] {
        return Object.keys(TEMPLATE_SCRIPTS) as ScriptType[];
    }

    /**
     * Get the in-memory fallback instance
     */
    getInMemoryFallback(): InMemoryFallback {
        return this.inMemoryFallback;
    }

    /**
     * Check rate limit with fallback
     * Uses Redis if available, in-memory otherwise
     */
    async checkRateLimitWithFallback(
        key: string,
        limit: number,
        windowMs: number,
        redisCheck?: () => Promise<boolean>
    ): Promise<boolean> {
        if (this.state.redis === 'normal' && redisCheck) {
            try {
                return await redisCheck();
            } catch (error) {
                logger.warn('Redis rate limit failed, using in-memory fallback', { error });
                this.setServiceState('redis', 'degraded');
            }
        }

        // Use in-memory fallback
        return this.inMemoryFallback.checkRateLimit(key, limit, windowMs);
    }

    /**
     * Generate fallback response for Gemini failures
     */
    getGeminiFallback(userIdea?: string): {
        scriptText: string;
        isTemplate: boolean;
        message: string;
    } {
        const type: ScriptType = this.detectScriptType(userIdea);

        return {
            scriptText: this.getTemplateScript(type, { topic: userIdea }),
            isTemplate: true,
            message: 'Generated using template (AI temporarily unavailable)',
        };
    }

    /**
     * Detect script type from user idea
     */
    private detectScriptType(userIdea?: string): ScriptType {
        if (!userIdea) return 'educational';

        const idea = userIdea.toLowerCase();

        if (idea.includes('funny') || idea.includes('comedy') || idea.includes('laugh')) {
            return 'entertaining';
        }
        if (idea.includes('product') || idea.includes('sell') || idea.includes('buy')) {
            return 'promotional';
        }
        if (idea.includes('story') || idea.includes('happened') || idea.includes('experience')) {
            return 'storytelling';
        }

        return 'educational';
    }

    /**
     * Stop the degradation service and cleanup intervals
     */
    stop(): void {
        this.inMemoryFallback.stop();
        logger.info('DegradationService stopped');
    }

    /**
     * Get service status summary for health checks
     */
    getStatusSummary(): {
        isHealthy: boolean;
        services: DegradationState;
        inMemoryStats: { rateLimits: number; sessions: number };
    } {
        return {
            isHealthy: this.isFullyOperational(),
            services: this.getState(),
            inMemoryStats: {
                rateLimits: this.inMemoryFallback.getStats().rateLimits,
                sessions: this.inMemoryFallback.getStats().sessions,
            },
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

export const degradationService = new DegradationService();

// ═══════════════════════════════════════════════════════════════════════════
// HELPER EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const inMemoryFallback = degradationService.getInMemoryFallback();

export function getTemplateScript(type?: ScriptType): string {
    return degradationService.getTemplateScript(type);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { DegradationService, InMemoryFallback };
export default degradationService;
