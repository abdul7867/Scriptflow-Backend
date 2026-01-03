/**
 * Circuit Breaker - Protect against cascading failures
 * 
 * ScriptFlow 2.0 Production Hardening
 * 
 * Implements the circuit breaker pattern for external services:
 * - Gemini AI API
 * - ManyChat API
 * - ImgBB API
 * - S3 Upload
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests fail fast
 * - HALF_OPEN: Testing if service recovered
 */

import { logger } from './logger';
import { getRedis } from '../queue/redis';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Service name for logging/metrics */
  name: string;
  
  /** Number of failures before opening circuit */
  failureThreshold: number;
  
  /** Milliseconds to wait before testing again */
  resetTimeout: number;
  
  /** Number of successful calls in HALF_OPEN to close circuit */
  successThreshold: number;
  
  /** Window in ms to count failures */
  failureWindow: number;
}

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  totalRequests: number;
  totalFailures: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT CONFIGS
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_CONFIGS: Record<string, CircuitBreakerConfig> = {
  gemini: {
    name: 'gemini',
    failureThreshold: 5,
    resetTimeout: 30000,      // 30 seconds
    successThreshold: 2,
    failureWindow: 60000,     // 1 minute
  },
  manychat: {
    name: 'manychat',
    failureThreshold: 5,
    resetTimeout: 30000,
    successThreshold: 2,
    failureWindow: 60000,
  },
  imgbb: {
    name: 'imgbb',
    failureThreshold: 3,
    resetTimeout: 60000,      // 1 minute (ImgBB has stricter limits)
    successThreshold: 2,
    failureWindow: 60000,
  },
  s3: {
    name: 's3',
    failureThreshold: 5,
    resetTimeout: 30000,
    successThreshold: 2,
    failureWindow: 60000,
  },
  'instagram-download': {
    name: 'instagram-download',
    failureThreshold: 3,      // Open circuit after 3 consecutive failures
    resetTimeout: 60000,      // Wait 60 seconds before retrying
    successThreshold: 1,      // 1 success to close circuit
    failureWindow: 120000,    // 2 minute window for counting failures
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'CLOSED';
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private lastStateChange: number = Date.now();
  private totalRequests: number = 0;
  private totalFailures: number = 0;
  
  constructor(config: CircuitBreakerConfig) {
    this.config = config;
    logger.info(`CircuitBreaker initialized for ${config.name}`, {
      failureThreshold: config.failureThreshold,
      resetTimeout: config.resetTimeout,
    });
  }
  
  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;
    
    // Check if circuit should transition
    this.checkStateTransition();
    
    // Fail fast if circuit is open
    if (this.state === 'OPEN') {
      logger.warn(`Circuit OPEN for ${this.config.name}, failing fast`);
      throw new CircuitOpenError(this.config.name, this.getTimeUntilReset());
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }
  
  /**
   * Check if we should allow a request (for manual checking)
   */
  canExecute(): boolean {
    this.checkStateTransition();
    return this.state !== 'OPEN';
  }
  
  /**
   * Get current circuit stats
   */
  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime || undefined,
      lastSuccessTime: this.successes > 0 ? Date.now() : undefined,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
    };
  }
  
  /**
   * Get current state
   */
  getState(): CircuitState {
    this.checkStateTransition();
    return this.state;
  }
  
  /**
   * Force reset the circuit (for admin/testing)
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
    this.lastStateChange = Date.now();
    
    logger.info(`Circuit RESET for ${this.config.name}`);
  }
  
  /**
   * Handle successful call
   */
  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo('CLOSED');
        this.failures = 0;
        this.successes = 0;
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success
      this.failures = 0;
    }
  }
  
  /**
   * Handle failed call
   */
  private onFailure(error: any): void {
    this.totalFailures++;
    this.lastFailureTime = Date.now();
    
    if (this.state === 'HALF_OPEN') {
      // Any failure in HALF_OPEN opens the circuit again
      this.transitionTo('OPEN');
      this.successes = 0;
    } else if (this.state === 'CLOSED') {
      this.failures++;
      
      if (this.failures >= this.config.failureThreshold) {
        this.transitionTo('OPEN');
      }
    }
    
    logger.warn(`Circuit ${this.config.name} failure`, {
      state: this.state,
      failures: this.failures,
      error: error.message,
    });
  }
  
  /**
   * Check if state should transition
   */
  private checkStateTransition(): void {
    const now = Date.now();
    
    if (this.state === 'OPEN') {
      // Check if reset timeout has passed
      if (now - this.lastStateChange >= this.config.resetTimeout) {
        this.transitionTo('HALF_OPEN');
        this.successes = 0;
      }
    } else if (this.state === 'CLOSED') {
      // Check if failures should reset (outside failure window)
      if (this.failures > 0 && now - this.lastFailureTime > this.config.failureWindow) {
        this.failures = 0;
      }
    }
  }
  
  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    
    logger.info(`Circuit ${this.config.name} state change: ${oldState} → ${newState}`);
    
    // Emit event for metrics
    circuitEvents.emit('stateChange', {
      name: this.config.name,
      oldState,
      newState,
      timestamp: this.lastStateChange,
    });
  }
  
  /**
   * Get time until circuit might reset (for error messages)
   */
  private getTimeUntilReset(): number {
    if (this.state !== 'OPEN') return 0;
    const elapsed = Date.now() - this.lastStateChange;
    return Math.max(0, this.config.resetTimeout - elapsed);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT OPEN ERROR
// ═══════════════════════════════════════════════════════════════════════════

export class CircuitOpenError extends Error {
  public readonly serviceName: string;
  public readonly retryAfterMs: number;
  
  constructor(serviceName: string, retryAfterMs: number) {
    super(`Circuit breaker OPEN for ${serviceName}. Retry after ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = 'CircuitOpenError';
    this.serviceName = serviceName;
    this.retryAfterMs = retryAfterMs;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT EMITTER FOR METRICS
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';

export const circuitEvents = new EventEmitter();

// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

const circuits: Map<string, CircuitBreaker> = new Map();

/**
 * Get or create a circuit breaker for a service
 */
export function getCircuitBreaker(serviceName: string): CircuitBreaker {
  if (!circuits.has(serviceName)) {
    const config = DEFAULT_CONFIGS[serviceName] || {
      name: serviceName,
      failureThreshold: 5,
      resetTimeout: 30000,
      successThreshold: 2,
      failureWindow: 60000,
    };
    
    circuits.set(serviceName, new CircuitBreaker(config));
  }
  
  return circuits.get(serviceName)!;
}

/**
 * Get all circuit breaker stats (for metrics/health check)
 */
export function getAllCircuitStats(): Record<string, CircuitStats> {
  const stats: Record<string, CircuitStats> = {};
  
  for (const [name, breaker] of circuits) {
    stats[name] = breaker.getStats();
  }
  
  return stats;
}

/**
 * Check if all circuits are healthy
 */
export function areCircuitsHealthy(): boolean {
  for (const [, breaker] of circuits) {
    if (breaker.getState() === 'OPEN') {
      return false;
    }
  }
  return true;
}

/**
 * Reset all circuits (for testing/admin)
 */
export function resetAllCircuits(): void {
  for (const [, breaker] of circuits) {
    breaker.reset();
  }
  logger.info('All circuits reset');
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wrap an async function with circuit breaker protection
 */
export function withCircuitBreaker<T>(
  serviceName: string,
  fn: () => Promise<T>
): Promise<T> {
  const breaker = getCircuitBreaker(serviceName);
  return breaker.execute(fn);
}

/**
 * Create a protected version of an async function
 */
export function protectFunction<T extends any[], R>(
  serviceName: string,
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  const breaker = getCircuitBreaker(serviceName);
  
  return async (...args: T): Promise<R> => {
    return breaker.execute(() => fn(...args));
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DISTRIBUTED CIRCUIT BREAKER (Redis-backed)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Distributed circuit breaker for multi-instance deployments
 * Uses Redis to share state across instances
 */
export class DistributedCircuitBreaker {
  private config: CircuitBreakerConfig;
  private redisKeyPrefix: string;
  
  constructor(config: CircuitBreakerConfig) {
    this.config = config;
    this.redisKeyPrefix = `circuit:${config.name}`;
  }
  
  /**
   * Execute with distributed circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = await this.getState();
    
    if (state === 'OPEN') {
      const ttl = await this.getTimeUntilReset();
      throw new CircuitOpenError(this.config.name, ttl * 1000);
    }
    
    try {
      const result = await fn();
      await this.recordSuccess();
      return result;
    } catch (error) {
      await this.recordFailure();
      throw error;
    }
  }
  
  /**
   * Get current state from Redis
   */
  async getState(): Promise<CircuitState> {
    try {
      const redis = getRedis();
      const state = await redis.get(`${this.redisKeyPrefix}:state`);
      
      if (!state) return 'CLOSED';
      
      // Check if OPEN state should transition to HALF_OPEN
      if (state === 'OPEN') {
        const openTime = await redis.get(`${this.redisKeyPrefix}:openTime`);
        if (openTime) {
          const elapsed = Date.now() - parseInt(openTime, 10);
          if (elapsed >= this.config.resetTimeout) {
            await this.setState('HALF_OPEN');
            return 'HALF_OPEN';
          }
        }
      }
      
      return state as CircuitState;
    } catch (error) {
      logger.error('Failed to get circuit state from Redis', { error });
      return 'CLOSED'; // Fail open
    }
  }
  
  /**
   * Set state in Redis
   */
  private async setState(state: CircuitState): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${this.redisKeyPrefix}:state`, state);
      
      if (state === 'OPEN') {
        await redis.set(`${this.redisKeyPrefix}:openTime`, Date.now().toString());
      }
    } catch (error) {
      logger.error('Failed to set circuit state in Redis', { error });
    }
  }
  
  /**
   * Record successful call
   */
  private async recordSuccess(): Promise<void> {
    try {
      const redis = getRedis();
      const state = await this.getState();
      
      if (state === 'HALF_OPEN') {
        const successes = await redis.incr(`${this.redisKeyPrefix}:halfOpenSuccesses`);
        
        if (successes >= this.config.successThreshold) {
          await this.setState('CLOSED');
          await redis.del(`${this.redisKeyPrefix}:failures`);
          await redis.del(`${this.redisKeyPrefix}:halfOpenSuccesses`);
        }
      } else if (state === 'CLOSED') {
        await redis.del(`${this.redisKeyPrefix}:failures`);
      }
    } catch (error) {
      logger.error('Failed to record success in Redis', { error });
    }
  }
  
  /**
   * Record failed call
   */
  private async recordFailure(): Promise<void> {
    try {
      const redis = getRedis();
      const state = await this.getState();
      
      if (state === 'HALF_OPEN') {
        await this.setState('OPEN');
        await redis.del(`${this.redisKeyPrefix}:halfOpenSuccesses`);
      } else if (state === 'CLOSED') {
        const failures = await redis.incr(`${this.redisKeyPrefix}:failures`);
        await redis.expire(`${this.redisKeyPrefix}:failures`, Math.ceil(this.config.failureWindow / 1000));
        
        if (failures >= this.config.failureThreshold) {
          await this.setState('OPEN');
        }
      }
    } catch (error) {
      logger.error('Failed to record failure in Redis', { error });
    }
  }
  
  /**
   * Get TTL until reset (in seconds)
   */
  private async getTimeUntilReset(): Promise<number> {
    try {
      const redis = getRedis();
      const openTime = await redis.get(`${this.redisKeyPrefix}:openTime`);
      
      if (!openTime) return 0;
      
      const elapsed = Date.now() - parseInt(openTime, 10);
      return Math.max(0, Math.ceil((this.config.resetTimeout - elapsed) / 1000));
    } catch (error) {
      return 0;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  CircuitBreaker,
  CircuitOpenError,
  getCircuitBreaker,
  getAllCircuitStats,
  areCircuitsHealthy,
  resetAllCircuits,
  withCircuitBreaker,
  protectFunction,
  circuitEvents,
  DistributedCircuitBreaker,
};
