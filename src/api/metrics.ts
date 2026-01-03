/**
 * Prometheus Metrics API
 * 
 * ScriptFlow 2.0 Production Monitoring
 * 
 * Exposes metrics for:
 * - Queue depth and processing times
 * - Cache hit ratios
 * - API latency histograms
 * - Circuit breaker states
 * - Error rates
 */

import { Router, Request, Response } from 'express';
import { getQueueStats } from '../queue/scriptQueue';
import { getAllCircuitStats, areCircuitsHealthy } from '../utils/circuitBreaker';
import { getRedis } from '../queue/redis';
import { logger } from '../utils/logger';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface MetricSample {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  values: MetricValue[];
}

interface MetricValue {
  labels?: Record<string, string>;
  value: number;
  buckets?: { le: string; value: number }[];
}

// ═══════════════════════════════════════════════════════════════════════════
// IN-MEMORY METRICS STORE
// ═══════════════════════════════════════════════════════════════════════════

class MetricsStore {
  private counters: Map<string, Map<string, number>> = new Map();
  private gauges: Map<string, Map<string, number>> = new Map();
  private histogramSums: Map<string, Map<string, number>> = new Map();
  private histogramCounts: Map<string, Map<string, number>> = new Map();
  private histogramBuckets: Map<string, Map<string, Map<string, number>>> = new Map();
  
  // Default histogram buckets for latency (in ms)
  private readonly LATENCY_BUCKETS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];
  
  // ─────────────────────────────────────────────────────────────────────────
  // Counters
  // ─────────────────────────────────────────────────────────────────────────
  
  incrementCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const key = this.labelsToKey(labels);
    
    if (!this.counters.has(name)) {
      this.counters.set(name, new Map());
    }
    
    const counter = this.counters.get(name)!;
    counter.set(key, (counter.get(key) || 0) + value);
  }
  
  getCounter(name: string): Map<string, number> {
    return this.counters.get(name) || new Map();
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Gauges
  // ─────────────────────────────────────────────────────────────────────────
  
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.labelsToKey(labels);
    
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Map());
    }
    
    this.gauges.get(name)!.set(key, value);
  }
  
  incrementGauge(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const key = this.labelsToKey(labels);
    
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Map());
    }
    
    const gauge = this.gauges.get(name)!;
    gauge.set(key, (gauge.get(key) || 0) + value);
  }
  
  decrementGauge(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    this.incrementGauge(name, labels, -value);
  }
  
  getGauge(name: string): Map<string, number> {
    return this.gauges.get(name) || new Map();
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Histograms
  // ─────────────────────────────────────────────────────────────────────────
  
  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.labelsToKey(labels);
    
    // Initialize if needed
    if (!this.histogramSums.has(name)) {
      this.histogramSums.set(name, new Map());
      this.histogramCounts.set(name, new Map());
      this.histogramBuckets.set(name, new Map());
    }
    
    // Update sum and count
    const sums = this.histogramSums.get(name)!;
    const counts = this.histogramCounts.get(name)!;
    
    sums.set(key, (sums.get(key) || 0) + value);
    counts.set(key, (counts.get(key) || 0) + 1);
    
    // Update buckets
    const buckets = this.histogramBuckets.get(name)!;
    if (!buckets.has(key)) {
      buckets.set(key, new Map());
      // Initialize buckets
      for (const bucket of this.LATENCY_BUCKETS) {
        buckets.get(key)!.set(bucket.toString(), 0);
      }
      buckets.get(key)!.set('+Inf', 0);
    }
    
    const labelBuckets = buckets.get(key)!;
    for (const bucket of this.LATENCY_BUCKETS) {
      if (value <= bucket) {
        labelBuckets.set(bucket.toString(), (labelBuckets.get(bucket.toString()) || 0) + 1);
      }
    }
    labelBuckets.set('+Inf', (labelBuckets.get('+Inf') || 0) + 1);
  }
  
  getHistogram(name: string): {
    sums: Map<string, number>;
    counts: Map<string, number>;
    buckets: Map<string, Map<string, number>>;
  } {
    return {
      sums: this.histogramSums.get(name) || new Map(),
      counts: this.histogramCounts.get(name) || new Map(),
      buckets: this.histogramBuckets.get(name) || new Map(),
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────
  
  private labelsToKey(labels: Record<string, string>): string {
    if (Object.keys(labels).length === 0) return '';
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }
  
  keyToLabels(key: string): Record<string, string> {
    if (!key) return {};
    const labels: Record<string, string> = {};
    const pairs = key.match(/(\w+)="([^"]+)"/g) || [];
    for (const pair of pairs) {
      const [, k, v] = pair.match(/(\w+)="([^"]+)"/) || [];
      if (k && v) labels[k] = v;
    }
    return labels;
  }
}

// Global metrics store
export const metrics = new MetricsStore();

// ═══════════════════════════════════════════════════════════════════════════
// METRIC DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const METRIC_DEFINITIONS: Record<string, { help: string; type: MetricSample['type'] }> = {
  // Counters
  scriptflow_requests_total: {
    help: 'Total number of script generation requests',
    type: 'counter',
  },
  scriptflow_errors_total: {
    help: 'Total number of errors by type',
    type: 'counter',
  },
  scriptflow_cache_hits_total: {
    help: 'Total cache hits',
    type: 'counter',
  },
  scriptflow_cache_misses_total: {
    help: 'Total cache misses',
    type: 'counter',
  },
  scriptflow_feedback_total: {
    help: 'Total feedback received by type',
    type: 'counter',
  },
  
  // Gauges
  scriptflow_queue_depth: {
    help: 'Current number of jobs in queue',
    type: 'gauge',
  },
  scriptflow_active_jobs: {
    help: 'Number of currently processing jobs',
    type: 'gauge',
  },
  scriptflow_circuit_breaker_state: {
    help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
    type: 'gauge',
  },
  scriptflow_active_sessions: {
    help: 'Number of active user sessions',
    type: 'gauge',
  },
  
  // Histograms
  scriptflow_request_duration_ms: {
    help: 'Request duration in milliseconds',
    type: 'histogram',
  },
  scriptflow_job_duration_ms: {
    help: 'Job processing duration in milliseconds',
    type: 'histogram',
  },
  scriptflow_gemini_duration_ms: {
    help: 'Gemini API call duration in milliseconds',
    type: 'histogram',
  },
  scriptflow_video_analysis_duration_ms: {
    help: 'Video analysis duration in milliseconds',
    type: 'histogram',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// FORMAT OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

function formatPrometheusMetrics(): string {
  const lines: string[] = [];
  
  // ─────────────────────────────────────────────────────────────────────────
  // Counters
  // ─────────────────────────────────────────────────────────────────────────
  
  for (const name of [
    'scriptflow_requests_total',
    'scriptflow_errors_total',
    'scriptflow_cache_hits_total',
    'scriptflow_cache_misses_total',
    'scriptflow_feedback_total',
  ]) {
    const def = METRIC_DEFINITIONS[name];
    const counter = metrics.getCounter(name);
    
    if (counter.size > 0 || name === 'scriptflow_requests_total') {
      lines.push(`# HELP ${name} ${def.help}`);
      lines.push(`# TYPE ${name} ${def.type}`);
      
      if (counter.size === 0) {
        lines.push(`${name} 0`);
      } else {
        for (const [labels, value] of counter) {
          const labelStr = labels ? `{${labels}}` : '';
          lines.push(`${name}${labelStr} ${value}`);
        }
      }
      lines.push('');
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Gauges
  // ─────────────────────────────────────────────────────────────────────────
  
  for (const name of [
    'scriptflow_queue_depth',
    'scriptflow_active_jobs',
    'scriptflow_circuit_breaker_state',
    'scriptflow_active_sessions',
  ]) {
    const def = METRIC_DEFINITIONS[name];
    const gauge = metrics.getGauge(name);
    
    lines.push(`# HELP ${name} ${def.help}`);
    lines.push(`# TYPE ${name} ${def.type}`);
    
    if (gauge.size === 0) {
      lines.push(`${name} 0`);
    } else {
      for (const [labels, value] of gauge) {
        const labelStr = labels ? `{${labels}}` : '';
        lines.push(`${name}${labelStr} ${value}`);
      }
    }
    lines.push('');
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Histograms
  // ─────────────────────────────────────────────────────────────────────────
  
  for (const name of [
    'scriptflow_request_duration_ms',
    'scriptflow_job_duration_ms',
    'scriptflow_gemini_duration_ms',
    'scriptflow_video_analysis_duration_ms',
  ]) {
    const def = METRIC_DEFINITIONS[name];
    const { sums, counts, buckets } = metrics.getHistogram(name);
    
    if (buckets.size > 0) {
      lines.push(`# HELP ${name} ${def.help}`);
      lines.push(`# TYPE ${name} ${def.type}`);
      
      for (const [labelKey, bucketMap] of buckets) {
        const labels = metrics.keyToLabels(labelKey);
        const baseLabels = labelKey ? `${labelKey},` : '';
        
        // Output bucket values
        for (const [le, value] of bucketMap) {
          lines.push(`${name}_bucket{${baseLabels}le="${le}"} ${value}`);
        }
        
        // Output sum and count
        const sum = sums.get(labelKey) || 0;
        const count = counts.get(labelKey) || 0;
        
        const labelStr = labelKey ? `{${labelKey}}` : '';
        lines.push(`${name}_sum${labelStr} ${sum}`);
        lines.push(`${name}_count${labelStr} ${count}`);
      }
      lines.push('');
    }
  }
  
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE DYNAMIC METRICS
// ═══════════════════════════════════════════════════════════════════════════

async function updateDynamicMetrics(): Promise<void> {
  try {
    // Queue metrics
    const queueStats = await getQueueStats();
    metrics.setGauge('scriptflow_queue_depth', queueStats.waiting + queueStats.delayed);
    metrics.setGauge('scriptflow_active_jobs', queueStats.active);
    
    // Circuit breaker metrics
    const circuitStats = getAllCircuitStats();
    for (const [service, stats] of Object.entries(circuitStats)) {
      const stateValue = stats.state === 'CLOSED' ? 0 : stats.state === 'HALF_OPEN' ? 1 : 2;
      metrics.setGauge('scriptflow_circuit_breaker_state', stateValue, { service });
    }
    
    // Active sessions from Redis
    try {
      const redis = getRedis();
      const sessionKeys = await redis.keys('session:*');
      metrics.setGauge('scriptflow_active_sessions', sessionKeys.length);
    } catch (e) {
      // Redis might not be available
    }
  } catch (error) {
    logger.error('Failed to update dynamic metrics', { error });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    await updateDynamicMetrics();
    
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(formatPrometheusMetrics());
  } catch (error) {
    logger.error('Failed to get metrics', { error });
    res.status(500).send('# Error generating metrics\n');
  }
});

/**
 * GET /metrics/json
 * JSON metrics endpoint (for debugging)
 */
router.get('/json', async (req: Request, res: Response) => {
  try {
    await updateDynamicMetrics();
    
    const circuitStats = getAllCircuitStats();
    const queueStats = await getQueueStats();
    
    res.json({
      queue: queueStats,
      circuits: circuitStats,
      circuitsHealthy: areCircuitsHealthy(),
      counters: Object.fromEntries(
        ['scriptflow_requests_total', 'scriptflow_errors_total', 'scriptflow_cache_hits_total']
          .map(name => [name, Object.fromEntries(metrics.getCounter(name))])
      ),
      gauges: Object.fromEntries(
        ['scriptflow_queue_depth', 'scriptflow_active_jobs', 'scriptflow_active_sessions']
          .map(name => [name, Object.fromEntries(metrics.getGauge(name))])
      ),
    });
  } catch (error) {
    logger.error('Failed to get JSON metrics', { error });
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS FOR RECORDING METRICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record a request
 */
export function recordRequest(labels: { flow: string; status: string }): void {
  metrics.incrementCounter('scriptflow_requests_total', labels);
}

/**
 * Record an error
 */
export function recordError(type: string): void {
  metrics.incrementCounter('scriptflow_errors_total', { type });
}

/**
 * Record cache hit/miss
 */
export function recordCacheResult(hit: boolean, cacheType: string = 'script'): void {
  if (hit) {
    metrics.incrementCounter('scriptflow_cache_hits_total', { type: cacheType });
  } else {
    metrics.incrementCounter('scriptflow_cache_misses_total', { type: cacheType });
  }
}

/**
 * Record feedback
 */
export function recordFeedback(type: 'positive' | 'negative' | 'redo'): void {
  metrics.incrementCounter('scriptflow_feedback_total', { type });
}

/**
 * Record request duration
 */
export function recordRequestDuration(durationMs: number, labels: { endpoint: string }): void {
  metrics.observeHistogram('scriptflow_request_duration_ms', durationMs, labels);
}

/**
 * Record job duration
 */
export function recordJobDuration(durationMs: number, labels: { status: string } = { status: 'success' }): void {
  metrics.observeHistogram('scriptflow_job_duration_ms', durationMs, labels);
}

/**
 * Record Gemini API duration
 */
export function recordGeminiDuration(durationMs: number): void {
  metrics.observeHistogram('scriptflow_gemini_duration_ms', durationMs);
}

/**
 * Record video analysis duration
 */
export function recordVideoAnalysisDuration(durationMs: number): void {
  metrics.observeHistogram('scriptflow_video_analysis_duration_ms', durationMs);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default router;

export {
  formatPrometheusMetrics,
  updateDynamicMetrics,
};
