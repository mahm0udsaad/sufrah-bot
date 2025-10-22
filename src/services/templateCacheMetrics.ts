import { prisma } from '../db/client';

/**
 * Template Cache Metrics Service
 * Tracks cache hits, misses, and provides alerting for cache efficiency
 */

interface CacheMetrics {
  hits: number;
  misses: number;
  creations: number;
  hitRate: number;
  missRate: number;
  totalRequests: number;
}

interface CacheEvent {
  timestamp: Date;
  key: string;
  eventType: 'hit' | 'miss' | 'creation';
  dataHash?: string;
  templateSid?: string;
  metadata?: Record<string, any>;
}

// In-memory tracking for recent events (rolling window)
const recentEvents: CacheEvent[] = [];
const MAX_EVENTS = 10000; // Keep last 10k events
const SPIKE_WINDOW_MS = 5 * 60 * 1000; // 5 minute window
const SPIKE_THRESHOLD = 0.5; // Alert if miss rate > 50%

// Cumulative counters
let totalHits = 0;
let totalMisses = 0;
let totalCreations = 0;

/**
 * Record a cache hit event
 */
export function recordCacheHit(
  key: string,
  dataHash: string,
  templateSid: string,
  metadata?: Record<string, any>
): void {
  totalHits++;
  
  const event: CacheEvent = {
    timestamp: new Date(),
    key,
    eventType: 'hit',
    dataHash,
    templateSid,
    metadata,
  };
  
  recentEvents.push(event);
  
  // Trim old events
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.shift();
  }
  
  console.log(`📊 [CacheMetrics] HIT - ${key} (hash: ${dataHash.substring(0, 8)}..., sid: ${templateSid})`);
}

/**
 * Record a cache miss event
 */
export function recordCacheMiss(
  key: string,
  dataHash: string,
  metadata?: Record<string, any>
): void {
  totalMisses++;
  
  const event: CacheEvent = {
    timestamp: new Date(),
    key,
    eventType: 'miss',
    dataHash,
    metadata,
  };
  
  recentEvents.push(event);
  
  // Trim old events
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.shift();
  }
  
  console.log(`⚠️ [CacheMetrics] MISS - ${key} (hash: ${dataHash.substring(0, 8)}...)`);
  
  // Check for spike
  checkForMissSpike();
}

/**
 * Record a template creation event
 */
export function recordCacheCreation(
  key: string,
  dataHash: string,
  templateSid: string,
  metadata?: Record<string, any>
): void {
  totalCreations++;
  
  const event: CacheEvent = {
    timestamp: new Date(),
    key,
    eventType: 'creation',
    dataHash,
    templateSid,
    metadata,
  };
  
  recentEvents.push(event);
  
  // Trim old events
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.shift();
  }
  
  console.log(`🆕 [CacheMetrics] CREATION - ${key} (hash: ${dataHash.substring(0, 8)}..., sid: ${templateSid})`);
}

/**
 * Get current cache metrics
 */
export function getCacheMetrics(): CacheMetrics {
  const totalRequests = totalHits + totalMisses;
  const hitRate = totalRequests > 0 ? totalHits / totalRequests : 0;
  const missRate = totalRequests > 0 ? totalMisses / totalRequests : 0;
  
  return {
    hits: totalHits,
    misses: totalMisses,
    creations: totalCreations,
    hitRate,
    missRate,
    totalRequests,
  };
}

/**
 * Get cache metrics for a specific time window
 */
export function getCacheMetricsWindow(windowMs: number = SPIKE_WINDOW_MS): CacheMetrics {
  const cutoff = new Date(Date.now() - windowMs);
  const windowEvents = recentEvents.filter(e => e.timestamp >= cutoff);
  
  const hits = windowEvents.filter(e => e.eventType === 'hit').length;
  const misses = windowEvents.filter(e => e.eventType === 'miss').length;
  const creations = windowEvents.filter(e => e.eventType === 'creation').length;
  const totalRequests = hits + misses;
  const hitRate = totalRequests > 0 ? hits / totalRequests : 0;
  const missRate = totalRequests > 0 ? misses / totalRequests : 0;
  
  return {
    hits,
    misses,
    creations,
    hitRate,
    missRate,
    totalRequests,
  };
}

/**
 * Get metrics by cache key
 */
export function getCacheMetricsByKey(): Record<string, CacheMetrics> {
  const byKey: Record<string, { hits: number; misses: number; creations: number }> = {};
  
  for (const event of recentEvents) {
    if (!byKey[event.key]) {
      byKey[event.key] = { hits: 0, misses: 0, creations: 0 };
    }
    
    if (event.eventType === 'hit') {
      byKey[event.key].hits++;
    } else if (event.eventType === 'miss') {
      byKey[event.key].misses++;
    } else if (event.eventType === 'creation') {
      byKey[event.key].creations++;
    }
  }
  
  const result: Record<string, CacheMetrics> = {};
  for (const [key, counts] of Object.entries(byKey)) {
    const totalRequests = counts.hits + counts.misses;
    const hitRate = totalRequests > 0 ? counts.hits / totalRequests : 0;
    const missRate = totalRequests > 0 ? counts.misses / totalRequests : 0;
    
    result[key] = {
      hits: counts.hits,
      misses: counts.misses,
      creations: counts.creations,
      hitRate,
      missRate,
      totalRequests,
    };
  }
  
  return result;
}

/**
 * Check for cache miss spike and alert if threshold exceeded
 */
function checkForMissSpike(): void {
  const windowMetrics = getCacheMetricsWindow(SPIKE_WINDOW_MS);
  
  // Only check if we have enough data
  if (windowMetrics.totalRequests < 10) {
    return;
  }
  
  if (windowMetrics.missRate > SPIKE_THRESHOLD) {
    console.error(
      `🚨 [CacheMetrics] ALERT: Cache miss spike detected! ` +
      `Miss rate: ${(windowMetrics.missRate * 100).toFixed(1)}% ` +
      `(${windowMetrics.misses}/${windowMetrics.totalRequests} requests in last ${SPIKE_WINDOW_MS / 1000}s)`
    );
    
    // Log per-key breakdown
    const byKey = getCacheMetricsByKey();
    const worstKeys = Object.entries(byKey)
      .filter(([_, metrics]) => metrics.missRate > 0.3)
      .sort(([_, a], [__, b]) => b.missRate - a.missRate)
      .slice(0, 5);
    
    if (worstKeys.length > 0) {
      console.error(`🚨 [CacheMetrics] Top keys with high miss rates:`);
      for (const [key, metrics] of worstKeys) {
        console.error(
          `   - ${key}: ${(metrics.missRate * 100).toFixed(1)}% miss rate ` +
          `(${metrics.misses}/${metrics.totalRequests} requests)`
        );
      }
    }
  }
}

/**
 * Get database cache statistics
 */
export async function getDatabaseCacheStats() {
  // Get total cached templates
  const totalTemplates = await prisma.contentTemplateCache.count();
  
  // Get templates by key
  const templatesByKey = await prisma.contentTemplateCache.groupBy({
    by: ['key'],
    _count: {
      key: true,
    },
  });
  
  // Get most recently used templates
  const recentlyUsed = await prisma.contentTemplateCache.findMany({
    orderBy: {
      lastUsedAt: 'desc',
    },
    take: 10,
    select: {
      key: true,
      dataHash: true,
      templateSid: true,
      friendlyName: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });
  
  // Get oldest templates (potentially stale)
  const staleTemplates = await prisma.contentTemplateCache.findMany({
    orderBy: {
      lastUsedAt: 'asc',
    },
    take: 10,
    select: {
      key: true,
      dataHash: true,
      templateSid: true,
      friendlyName: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });
  
  return {
    totalTemplates,
    templatesByKey,
    recentlyUsed,
    staleTemplates,
  };
}

/**
 * Get comprehensive cache report
 */
export async function getCacheReport() {
  const runtimeMetrics = getCacheMetrics();
  const windowMetrics = getCacheMetricsWindow(SPIKE_WINDOW_MS);
  const byKey = getCacheMetricsByKey();
  const dbStats = await getDatabaseCacheStats();
  
  return {
    runtime: {
      cumulative: runtimeMetrics,
      window: {
        durationMs: SPIKE_WINDOW_MS,
        metrics: windowMetrics,
      },
      byKey,
    },
    database: dbStats,
    health: {
      cumulativeHitRate: runtimeMetrics.hitRate,
      windowHitRate: windowMetrics.hitRate,
      missRateAboveThreshold: windowMetrics.missRate > SPIKE_THRESHOLD,
      threshold: SPIKE_THRESHOLD,
    },
  };
}

/**
 * Reset runtime metrics (useful for testing)
 */
export function resetMetrics(): void {
  totalHits = 0;
  totalMisses = 0;
  totalCreations = 0;
  recentEvents.length = 0;
  console.log('🔄 [CacheMetrics] Metrics reset');
}

/**
 * Log periodic cache metrics summary
 */
export function logCacheMetricsSummary(): void {
  const metrics = getCacheMetrics();
  const windowMetrics = getCacheMetricsWindow(SPIKE_WINDOW_MS);
  
  console.log('📊 [CacheMetrics] Summary:');
  console.log(`   Cumulative: ${metrics.hits} hits, ${metrics.misses} misses, ${metrics.creations} creations`);
  console.log(`   Hit rate: ${(metrics.hitRate * 100).toFixed(1)}%`);
  console.log(`   Recent window (${SPIKE_WINDOW_MS / 1000}s): ${(windowMetrics.hitRate * 100).toFixed(1)}% hit rate`);
  
  // Show top keys
  const byKey = getCacheMetricsByKey();
  const topKeys = Object.entries(byKey)
    .sort(([_, a], [__, b]) => b.totalRequests - a.totalRequests)
    .slice(0, 5);
  
  if (topKeys.length > 0) {
    console.log('   Top keys by usage:');
    for (const [key, keyMetrics] of topKeys) {
      console.log(
        `      - ${key}: ${keyMetrics.totalRequests} requests ` +
        `(${(keyMetrics.hitRate * 100).toFixed(1)}% hit rate)`
      );
    }
  }
}

// Start periodic logging (every 5 minutes)
let metricsInterval: Timer | null = null;

export function startMetricsLogging(intervalMs: number = 5 * 60 * 1000): void {
  if (metricsInterval) {
    return;
  }
  
  metricsInterval = setInterval(() => {
    logCacheMetricsSummary();
  }, intervalMs);
  
  console.log(`📊 [CacheMetrics] Started periodic logging (every ${intervalMs / 1000}s)`);
}

export function stopMetricsLogging(): void {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
    console.log('📊 [CacheMetrics] Stopped periodic logging');
  }
}

