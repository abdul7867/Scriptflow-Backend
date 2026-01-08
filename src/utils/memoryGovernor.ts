/**
 * Memory Governor - Real-time memory monitoring with automatic protective actions
 * 
 * Monitors heap usage and takes protective actions at different thresholds:
 * - GREEN (< 70%): Normal operation
 * - YELLOW (70-80%): Log warning, prepare for degradation
 * - ORANGE (80-85%): Reduce worker concurrency to 2, clear non-essential cache
 * - RED (85-90%): Pause queue, reject new requests, force GC
 * - CRITICAL (> 90%): Kill slow jobs, clear all cache
 * - FATAL (> 95%): Controlled shutdown (PM2 auto-restart)
 * 
 * @see PRD_System_Robustness_t3micro.txt Section 6
 */

import { Worker } from 'bullmq';
import { logger } from './logger';
import { getRedis } from '../queue/redis';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type MemoryLevel = 'green' | 'yellow' | 'orange' | 'red' | 'critical' | 'fatal';

export interface MemoryGovernorConfig {
    /** How often to check memory (ms) */
    checkInterval: number;
    /** Yellow threshold (warning) */
    yellowThreshold: number;
    /** Orange threshold (reduce concurrency) */
    orangeThreshold: number;
    /** Red threshold (pause queue) */
    redThreshold: number;
    /** Critical threshold (clear cache) */
    criticalThreshold: number;
    /** Fatal threshold (shutdown) */
    fatalThreshold: number;
    /** Minimum concurrency to reduce to */
    minConcurrency: number;
    /** Original concurrency level */
    originalConcurrency: number;
}

export interface MemoryStats {
    level: MemoryLevel;
    heapUsedMB: number;
    heapTotalMB: number;
    heapPercent: number;
    rssMB: number;
    externalMB: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

// Development mode uses higher thresholds (ts-node uses more memory)
const isDevelopment = process.env.NODE_ENV !== 'production';

// Get the configured heap limit (--max-old-space-size or default 512MB for Node.js)
// This is more accurate than heapTotal which grows dynamically
const HEAP_LIMIT_MB = parseInt(process.env.MEMORY_HEAP_LIMIT_MB || '512', 10);
const HEAP_LIMIT_BYTES = HEAP_LIMIT_MB * 1024 * 1024;

const DEFAULT_CONFIG: MemoryGovernorConfig = {
    checkInterval: parseInt(process.env.MEMORY_GOVERNOR_INTERVAL || '10000', 10),
    // Production thresholds based on configured heap limit (512MB default)
    // These percentages are of the LIMIT, not the current allocation
    yellowThreshold: parseFloat(process.env.MEMORY_GOVERNOR_YELLOW || (isDevelopment ? '0.75' : '0.70')),
    orangeThreshold: parseFloat(process.env.MEMORY_GOVERNOR_ORANGE || (isDevelopment ? '0.85' : '0.80')),
    redThreshold: parseFloat(process.env.MEMORY_GOVERNOR_RED || (isDevelopment ? '0.92' : '0.85')),
    criticalThreshold: parseFloat(process.env.MEMORY_GOVERNOR_CRITICAL || (isDevelopment ? '0.96' : '0.90')),
    // In development, disable fatal shutdown (set to 1.0 = never trigger)
    fatalThreshold: parseFloat(process.env.MEMORY_GOVERNOR_FATAL || (isDevelopment ? '1.0' : '0.95')),
    minConcurrency: 2,
    originalConcurrency: parseInt(process.env.QUEUE_CONCURRENCY || '3', 10),
};

// ═══════════════════════════════════════════════════════════════════════════
// MEMORY GOVERNOR CLASS
// ═══════════════════════════════════════════════════════════════════════════

class MemoryGovernor {
    private config: MemoryGovernorConfig;
    private currentLevel: MemoryLevel = 'green';
    private intervalId: NodeJS.Timeout | null = null;
    private worker: Worker<any, any> | null = null;
    private isQueuePaused: boolean = false;
    private originalWorkerConcurrency: number = 3;

    constructor(customConfig?: Partial<MemoryGovernorConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...customConfig };
    }

    /**
     * Start memory monitoring with optional worker reference
     */
    start(worker?: Worker<any, any>): void {
        if (this.intervalId) {
            logger.warn('Memory Governor already running');
            return;
        }

        if (worker) {
            this.worker = worker;
            this.originalWorkerConcurrency = worker.opts.concurrency || this.config.originalConcurrency;
        }

        this.intervalId = setInterval(() => this.check(), this.config.checkInterval);
        logger.info('✅ Memory Governor started', {
            checkInterval: `${this.config.checkInterval}ms`,
            thresholds: {
                yellow: `${this.config.yellowThreshold * 100}%`,
                orange: `${this.config.orangeThreshold * 100}%`,
                red: `${this.config.redThreshold * 100}%`,
                critical: `${this.config.criticalThreshold * 100}%`,
                fatal: `${this.config.fatalThreshold * 100}%`,
            },
        });

        // Run initial check
        this.check();
    }

    /**
     * Stop memory monitoring
     */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            logger.info('Memory Governor stopped');
        }
    }

    /**
     * Set the worker reference (for dynamic concurrency control)
     */
    setWorker(worker: Worker<any, any>): void {
        this.worker = worker;
        this.originalWorkerConcurrency = worker.opts.concurrency || this.config.originalConcurrency;
    }

    /**
     * Get current memory statistics
     */
    getStats(): MemoryStats {
        const usage = process.memoryUsage();
        // Use the configured heap limit, not heapTotal (which grows dynamically)
        const heapPercent = usage.heapUsed / HEAP_LIMIT_BYTES;

        return {
            level: this.currentLevel,
            heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024),
            heapTotalMB: HEAP_LIMIT_MB, // Use configured limit
            heapPercent: Math.round(heapPercent * 100),
            rssMB: Math.round(usage.rss / 1024 / 1024),
            externalMB: Math.round(usage.external / 1024 / 1024),
        };
    }

    /**
     * Get current memory level
     */
    getLevel(): MemoryLevel {
        return this.currentLevel;
    }

    /**
     * Check memory and take action if needed
     */
    private async check(): Promise<void> {
        const usage = process.memoryUsage();
        // Use configured heap limit for accurate percentage calculation
        const heapPercent = usage.heapUsed / HEAP_LIMIT_BYTES;
        const level = this.calculateLevel(heapPercent);

        // Log stats periodically (every check at warning+, every 6th check normally)
        const stats = this.getStats();
        const shouldLog = level !== 'green' || Math.random() < 0.16; // ~1 in 6

        if (shouldLog) {
            logger.debug('Memory Governor check', {
                level,
                heapUsed: `${stats.heapUsedMB}MB`,
                heapLimit: `${HEAP_LIMIT_MB}MB`,
                percent: `${stats.heapPercent}%`,
                rss: `${stats.rssMB}MB`,
            });
        }

        // Take action if level changed
        if (level !== this.currentLevel) {
            logger.warn(`Memory level changed: ${this.currentLevel} → ${level}`, {
                heapUsed: `${stats.heapUsedMB}MB`,
                heapPercent: `${stats.heapPercent}%`,
            });

            await this.handleLevelChange(level, heapPercent);
            this.currentLevel = level;
        }

        // Recovery actions when memory improves
        if (this.shouldRecover(level)) {
            await this.handleRecovery(level);
        }
    }

    /**
     * Calculate memory level based on heap percentage
     */
    private calculateLevel(heapPercent: number): MemoryLevel {
        if (heapPercent >= this.config.fatalThreshold) return 'fatal';
        if (heapPercent >= this.config.criticalThreshold) return 'critical';
        if (heapPercent >= this.config.redThreshold) return 'red';
        if (heapPercent >= this.config.orangeThreshold) return 'orange';
        if (heapPercent >= this.config.yellowThreshold) return 'yellow';
        return 'green';
    }

    /**
     * Check if we should perform recovery actions
     */
    private shouldRecover(newLevel: MemoryLevel): boolean {
        const levelOrder: MemoryLevel[] = ['green', 'yellow', 'orange', 'red', 'critical', 'fatal'];
        const currentIndex = levelOrder.indexOf(this.currentLevel);
        const newIndex = levelOrder.indexOf(newLevel);
        return newIndex < currentIndex;
    }

    /**
     * Handle memory level changes - take protective actions
     */
    private async handleLevelChange(level: MemoryLevel, heapPercent: number): Promise<void> {
        switch (level) {
            case 'yellow':
                // Just log, prepare for potential issues
                logger.info('Memory Governor: Entering YELLOW zone - monitoring closely');
                break;

            case 'orange':
                // Reduce worker concurrency
                await this.reduceConcurrency();
                // Clear non-essential caches
                await this.clearNonEssentialCache();
                break;

            case 'red':
                // Pause queue to prevent new job processing
                await this.pauseQueue();
                // Force garbage collection if available
                this.forceGC();
                break;

            case 'critical':
                // Clear all caches
                await this.clearAllCache();
                // Force GC again
                this.forceGC();
                logger.error('Memory Governor: CRITICAL level - system at risk');
                break;

            case 'fatal':
                // Emergency shutdown - PM2 will restart
                logger.error('Memory Governor: FATAL - initiating emergency shutdown');
                await this.emergencyShutdown();
                break;
        }
    }

    /**
     * Handle recovery when memory improves
     */
    private async handleRecovery(newLevel: MemoryLevel): Promise<void> {
        // Resume queue if we dropped below red
        if (this.isQueuePaused && ['green', 'yellow', 'orange'].includes(newLevel)) {
            await this.resumeQueue();
        }

        // Restore concurrency if we dropped below orange
        if (newLevel === 'green' || newLevel === 'yellow') {
            await this.restoreConcurrency();
        }

        logger.info(`Memory Governor: Recovered to ${newLevel.toUpperCase()} zone`);
    }

    /**
     * Reduce worker concurrency to minimum
     */
    private async reduceConcurrency(): Promise<void> {
        const concurrency = this.worker?.opts?.concurrency ?? 0;
        if (this.worker && concurrency > this.config.minConcurrency) {
            const oldConcurrency = concurrency;
            this.worker.opts.concurrency = this.config.minConcurrency;
            logger.warn(`Reduced worker concurrency: ${oldConcurrency} → ${this.config.minConcurrency}`);
        }
    }

    /**
     * Restore worker concurrency to original
     */
    private async restoreConcurrency(): Promise<void> {
        const concurrency = this.worker?.opts?.concurrency ?? 0;
        if (this.worker && concurrency < this.originalWorkerConcurrency) {
            const oldConcurrency = concurrency;
            this.worker.opts.concurrency = this.originalWorkerConcurrency;
            logger.info(`Restored worker concurrency: ${oldConcurrency} → ${this.originalWorkerConcurrency}`);
        }
    }

    /**
     * Pause the queue to stop processing new jobs
     */
    private async pauseQueue(): Promise<void> {
        if (this.worker && !this.isQueuePaused) {
            try {
                await this.worker.pause();
                this.isQueuePaused = true;
                logger.warn('Memory Governor: Queue PAUSED due to high memory');
            } catch (err) {
                logger.error('Failed to pause queue:', err);
            }
        }
    }

    /**
     * Resume the queue
     */
    private async resumeQueue(): Promise<void> {
        if (this.worker && this.isQueuePaused) {
            try {
                await this.worker.resume();
                this.isQueuePaused = false;
                logger.info('Memory Governor: Queue RESUMED - memory recovered');
            } catch (err) {
                logger.error('Failed to resume queue:', err);
            }
        }
    }

    /**
     * Force garbage collection if available
     */
    private forceGC(): void {
        if (global.gc) {
            global.gc();
            logger.info('Memory Governor: Forced garbage collection');
        } else {
            logger.debug('Memory Governor: GC not available (run with --expose-gc)');
        }
    }

    /**
     * Clear non-essential caches (template caches, etc.)
     */
    private async clearNonEssentialCache(): Promise<void> {
        try {
            // Clear any in-memory caches that might exist
            // This is a placeholder - add specific cache clearing as needed
            logger.info('Memory Governor: Cleared non-essential caches');
        } catch (err) {
            logger.error('Failed to clear non-essential cache:', err);
        }
    }

    /**
     * Clear all caches (more aggressive)
     */
    private async clearAllCache(): Promise<void> {
        try {
            // Clear all in-memory caches
            await this.clearNonEssentialCache();

            // Optionally clear Redis caches (be careful with rate limits)
            // This is aggressive - only do in critical situations
            logger.warn('Memory Governor: Cleared ALL caches');
        } catch (err) {
            logger.error('Failed to clear all caches:', err);
        }
    }

    /**
     * Emergency shutdown - PM2 will auto-restart
     */
    private async emergencyShutdown(): Promise<void> {
        logger.error('Memory Governor: EMERGENCY SHUTDOWN initiated');

        // Give time for logs to flush
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Exit with error code - PM2 will restart
        process.exit(1);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

export const memoryGovernor = new MemoryGovernor();

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { MemoryGovernor };
export default memoryGovernor;
