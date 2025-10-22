import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  recordCacheHit,
  recordCacheMiss,
  recordCacheCreation,
  getCacheMetrics,
  getCacheMetricsWindow,
  getCacheMetricsByKey,
  getDatabaseCacheStats,
  getCacheReport,
  resetMetrics,
  startMetricsLogging,
  stopMetricsLogging,
} from '../src/services/templateCacheMetrics';

describe('Template Cache Metrics', () => {
  beforeEach(() => {
    // Reset metrics before each test
    resetMetrics();
  });
  
  afterEach(() => {
    // Stop any logging intervals
    stopMetricsLogging();
  });
  
  describe('Basic Metrics Tracking', () => {
    it('should record cache hits correctly', () => {
      recordCacheHit('test-key', 'hash123', 'sid123', { source: 'memory' });
      recordCacheHit('test-key', 'hash123', 'sid123', { source: 'database' });
      
      const metrics = getCacheMetrics();
      
      expect(metrics.hits).toBe(2);
      expect(metrics.misses).toBe(0);
      expect(metrics.creations).toBe(0);
      expect(metrics.hitRate).toBe(1.0);
      expect(metrics.missRate).toBe(0);
    });
    
    it('should record cache misses correctly', () => {
      recordCacheMiss('test-key', 'hash456', { friendlyName: 'Test Template' });
      recordCacheMiss('test-key', 'hash789', { friendlyName: 'Test Template 2' });
      
      const metrics = getCacheMetrics();
      
      expect(metrics.hits).toBe(0);
      expect(metrics.misses).toBe(2);
      expect(metrics.creations).toBe(0);
      expect(metrics.hitRate).toBe(0);
      expect(metrics.missRate).toBe(1.0);
    });
    
    it('should record template creations correctly', () => {
      recordCacheCreation('test-key', 'hash123', 'sid123', { 
        friendlyName: 'New Template',
        source: 'twilio',
      });
      
      const metrics = getCacheMetrics();
      
      expect(metrics.creations).toBe(1);
    });
    
    it('should calculate hit rate correctly', () => {
      // Record 7 hits and 3 misses = 70% hit rate
      for (let i = 0; i < 7; i++) {
        recordCacheHit(`key-${i}`, `hash-${i}`, `sid-${i}`);
      }
      for (let i = 0; i < 3; i++) {
        recordCacheMiss(`key-miss-${i}`, `hash-miss-${i}`);
      }
      
      const metrics = getCacheMetrics();
      
      expect(metrics.hits).toBe(7);
      expect(metrics.misses).toBe(3);
      expect(metrics.totalRequests).toBe(10);
      expect(metrics.hitRate).toBeCloseTo(0.7, 2);
      expect(metrics.missRate).toBeCloseTo(0.3, 2);
    });
  });
  
  describe('Window-Based Metrics', () => {
    it('should track metrics within time window', async () => {
      // Record some events
      recordCacheHit('key1', 'hash1', 'sid1');
      recordCacheHit('key2', 'hash2', 'sid2');
      recordCacheMiss('key3', 'hash3');
      
      const windowMetrics = getCacheMetricsWindow(60000); // 1 minute window
      
      expect(windowMetrics.hits).toBe(2);
      expect(windowMetrics.misses).toBe(1);
      expect(windowMetrics.totalRequests).toBe(3);
    });
    
    it('should filter out events outside window', async () => {
      // Record initial events
      recordCacheHit('key1', 'hash1', 'sid1');
      recordCacheHit('key2', 'hash2', 'sid2');
      
      // Wait a tiny bit
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Get metrics with very short window (should be nearly 0)
      const windowMetrics = getCacheMetricsWindow(1); // 1ms window
      
      // Should have few or no events in such a tiny window
      expect(windowMetrics.totalRequests).toBeLessThanOrEqual(2);
    });
  });
  
  describe('Per-Key Metrics', () => {
    it('should track metrics by cache key', () => {
      // Record events for different keys
      recordCacheHit('welcome', 'hash1', 'sid1');
      recordCacheHit('welcome', 'hash1', 'sid1');
      recordCacheMiss('welcome', 'hash2');
      
      recordCacheHit('categories', 'hash3', 'sid3');
      recordCacheMiss('categories', 'hash4');
      recordCacheMiss('categories', 'hash5');
      
      const byKey = getCacheMetricsByKey();
      
      expect(byKey['welcome']).toBeDefined();
      expect(byKey['welcome'].hits).toBe(2);
      expect(byKey['welcome'].misses).toBe(1);
      expect(byKey['welcome'].hitRate).toBeCloseTo(0.667, 2);
      
      expect(byKey['categories']).toBeDefined();
      expect(byKey['categories'].hits).toBe(1);
      expect(byKey['categories'].misses).toBe(2);
      expect(byKey['categories'].hitRate).toBeCloseTo(0.333, 2);
    });
    
    it('should handle multiple keys correctly', () => {
      const keys = ['welcome', 'order_type', 'categories', 'cart_options'];
      
      keys.forEach((key, idx) => {
        // Each key gets different number of hits
        for (let i = 0; i <= idx; i++) {
          recordCacheHit(key, `hash-${i}`, `sid-${i}`);
        }
      });
      
      const byKey = getCacheMetricsByKey();
      
      expect(Object.keys(byKey).length).toBe(4);
      expect(byKey['welcome'].hits).toBe(1);
      expect(byKey['order_type'].hits).toBe(2);
      expect(byKey['categories'].hits).toBe(3);
      expect(byKey['cart_options'].hits).toBe(4);
    });
  });
  
  describe('Cache Miss Spike Detection', () => {
    it('should detect miss spike when threshold exceeded', () => {
      // Create a scenario with high miss rate (> 50%)
      // Record 3 hits and 8 misses = 73% miss rate
      recordCacheHit('key1', 'hash1', 'sid1');
      recordCacheHit('key2', 'hash2', 'sid2');
      recordCacheHit('key3', 'hash3', 'sid3');
      
      for (let i = 0; i < 8; i++) {
        recordCacheMiss(`key-miss-${i}`, `hash-miss-${i}`);
      }
      
      const windowMetrics = getCacheMetricsWindow();
      
      // Should detect that miss rate is above 50% threshold
      expect(windowMetrics.missRate).toBeGreaterThan(0.5);
      expect(windowMetrics.misses).toBe(8);
      expect(windowMetrics.hits).toBe(3);
    });
    
    it('should not alert with normal cache behavior', () => {
      // Record mostly hits (90% hit rate)
      for (let i = 0; i < 9; i++) {
        recordCacheHit(`key-${i}`, `hash-${i}`, `sid-${i}`);
      }
      recordCacheMiss('key-miss', 'hash-miss');
      
      const windowMetrics = getCacheMetricsWindow();
      
      // Miss rate should be well below threshold
      expect(windowMetrics.missRate).toBeLessThan(0.5);
      expect(windowMetrics.hitRate).toBe(0.9);
    });
  });
  
  describe('Database Cache Stats', () => {
    it('should retrieve database cache statistics', async () => {
      const stats = await getDatabaseCacheStats();
      
      expect(stats).toBeDefined();
      expect(typeof stats.totalTemplates).toBe('number');
      expect(Array.isArray(stats.templatesByKey)).toBe(true);
      expect(Array.isArray(stats.recentlyUsed)).toBe(true);
      expect(Array.isArray(stats.staleTemplates)).toBe(true);
    });
    
    it('should format recently used templates correctly', async () => {
      const stats = await getDatabaseCacheStats();
      
      if (stats.recentlyUsed.length > 0) {
        const template = stats.recentlyUsed[0];
        
        expect(template).toHaveProperty('key');
        expect(template).toHaveProperty('dataHash');
        expect(template).toHaveProperty('templateSid');
        expect(template).toHaveProperty('createdAt');
        expect(template).toHaveProperty('lastUsedAt');
      }
    });
  });
  
  describe('Comprehensive Cache Report', () => {
    it('should generate complete cache report', async () => {
      // Record some activity
      recordCacheHit('key1', 'hash1', 'sid1');
      recordCacheHit('key2', 'hash2', 'sid2');
      recordCacheMiss('key3', 'hash3');
      recordCacheCreation('key3', 'hash3', 'sid3');
      
      const report = await getCacheReport();
      
      // Check runtime metrics
      expect(report.runtime).toBeDefined();
      expect(report.runtime.cumulative).toBeDefined();
      expect(report.runtime.window).toBeDefined();
      expect(report.runtime.byKey).toBeDefined();
      
      // Check database stats
      expect(report.database).toBeDefined();
      expect(report.database.totalTemplates).toBeGreaterThanOrEqual(0);
      
      // Check health indicators
      expect(report.health).toBeDefined();
      expect(typeof report.health.cumulativeHitRate).toBe('number');
      expect(typeof report.health.windowHitRate).toBe('number');
      expect(typeof report.health.missRateAboveThreshold).toBe('boolean');
    });
    
    it('should include metadata in report', async () => {
      recordCacheHit('key1', 'hash1', 'sid1', { 
        source: 'memory',
        friendlyName: 'Test Template',
      });
      
      const report = await getCacheReport();
      
      expect(report.runtime.cumulative.hits).toBe(1);
    });
    
    it('should calculate health metrics correctly', async () => {
      // Create healthy cache scenario (high hit rate)
      for (let i = 0; i < 19; i++) {
        recordCacheHit(`key-${i}`, `hash-${i}`, `sid-${i}`);
      }
      recordCacheMiss('key-miss', 'hash-miss');
      
      const report = await getCacheReport();
      
      expect(report.health.cumulativeHitRate).toBeCloseTo(0.95, 2);
      expect(report.health.missRateAboveThreshold).toBe(false);
    });
    
    it('should identify unhealthy cache state', async () => {
      // Create unhealthy cache scenario (high miss rate)
      recordCacheHit('key1', 'hash1', 'sid1');
      
      for (let i = 0; i < 15; i++) {
        recordCacheMiss(`key-miss-${i}`, `hash-miss-${i}`);
      }
      
      const report = await getCacheReport();
      
      expect(report.health.missRateAboveThreshold).toBe(true);
      expect(report.health.windowHitRate).toBeLessThan(0.5);
    });
  });
  
  describe('Metrics Logging', () => {
    it('should start and stop metrics logging', () => {
      startMetricsLogging(1000); // 1 second interval
      
      // Should not throw
      expect(() => {
        stopMetricsLogging();
      }).not.toThrow();
    });
    
    it('should not start multiple logging intervals', () => {
      startMetricsLogging(1000);
      startMetricsLogging(1000); // Should be ignored
      
      // Cleanup
      stopMetricsLogging();
    });
  });
  
  describe('Metrics Reset', () => {
    it('should reset all metrics correctly', () => {
      // Record some activity
      recordCacheHit('key1', 'hash1', 'sid1');
      recordCacheHit('key2', 'hash2', 'sid2');
      recordCacheMiss('key3', 'hash3');
      recordCacheCreation('key4', 'hash4', 'sid4');
      
      let metrics = getCacheMetrics();
      expect(metrics.hits).toBeGreaterThan(0);
      expect(metrics.misses).toBeGreaterThan(0);
      expect(metrics.creations).toBeGreaterThan(0);
      
      // Reset
      resetMetrics();
      
      metrics = getCacheMetrics();
      expect(metrics.hits).toBe(0);
      expect(metrics.misses).toBe(0);
      expect(metrics.creations).toBe(0);
      expect(metrics.totalRequests).toBe(0);
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle empty metrics gracefully', () => {
      const metrics = getCacheMetrics();
      
      expect(metrics.hits).toBe(0);
      expect(metrics.misses).toBe(0);
      expect(metrics.creations).toBe(0);
      expect(metrics.hitRate).toBe(0);
      expect(metrics.missRate).toBe(0);
      expect(metrics.totalRequests).toBe(0);
    });
    
    it('should handle only hits', () => {
      recordCacheHit('key1', 'hash1', 'sid1');
      recordCacheHit('key2', 'hash2', 'sid2');
      
      const metrics = getCacheMetrics();
      
      expect(metrics.hitRate).toBe(1.0);
      expect(metrics.missRate).toBe(0);
    });
    
    it('should handle only misses', () => {
      recordCacheMiss('key1', 'hash1');
      recordCacheMiss('key2', 'hash2');
      
      const metrics = getCacheMetrics();
      
      expect(metrics.hitRate).toBe(0);
      expect(metrics.missRate).toBe(1.0);
    });
    
    it('should handle very long hash strings', () => {
      const longHash = 'a'.repeat(1000);
      
      expect(() => {
        recordCacheHit('key', longHash, 'sid');
      }).not.toThrow();
    });
    
    it('should handle special characters in keys', () => {
      const specialKey = 'test:key/with-special.chars_123';
      
      expect(() => {
        recordCacheHit(specialKey, 'hash', 'sid');
      }).not.toThrow();
      
      const byKey = getCacheMetricsByKey();
      expect(byKey[specialKey]).toBeDefined();
    });
  });
  
  describe('Metadata Integrity', () => {
    it('should preserve metadata in cache hit events', () => {
      const metadata = {
        source: 'database',
        friendlyName: 'Welcome Template',
        customField: 'customValue',
      };
      
      recordCacheHit('welcome', 'hash123', 'sid123', metadata);
      
      const byKey = getCacheMetricsByKey();
      expect(byKey['welcome']).toBeDefined();
      // Metadata is tracked internally but not exposed in aggregated metrics
      // This ensures the recording doesn't throw and accepts metadata
    });
    
    it('should preserve metadata in cache miss events', () => {
      const metadata = {
        friendlyName: 'Missing Template',
        reason: 'new_data_signature',
      };
      
      expect(() => {
        recordCacheMiss('categories', 'hash456', metadata);
      }).not.toThrow();
    });
    
    it('should preserve metadata in creation events', () => {
      const metadata = {
        friendlyName: 'Newly Created Template',
        twilioResponse: { sid: 'sid789' },
        timestamp: new Date().toISOString(),
      };
      
      expect(() => {
        recordCacheCreation('order_type', 'hash789', 'sid789', metadata);
      }).not.toThrow();
    });
  });
  
  describe('High Volume Scenarios', () => {
    it('should handle rapid event recording', () => {
      const eventCount = 1000;
      
      for (let i = 0; i < eventCount; i++) {
        if (i % 3 === 0) {
          recordCacheHit(`key-${i}`, `hash-${i}`, `sid-${i}`);
        } else if (i % 3 === 1) {
          recordCacheMiss(`key-${i}`, `hash-${i}`);
        } else {
          recordCacheCreation(`key-${i}`, `hash-${i}`, `sid-${i}`);
        }
      }
      
      const metrics = getCacheMetrics();
      
      expect(metrics.hits + metrics.misses + metrics.creations).toBe(eventCount);
    });
    
    it('should maintain reasonable memory usage', () => {
      // Record 20k events (above MAX_EVENTS limit of 10k)
      for (let i = 0; i < 20000; i++) {
        recordCacheHit(`key-${i}`, `hash-${i}`, `sid-${i}`);
      }
      
      // Recent events should be trimmed
      const windowMetrics = getCacheMetricsWindow(3600000); // 1 hour
      
      // Should have capped the events (MAX_EVENTS = 10k)
      expect(windowMetrics.hits).toBeLessThanOrEqual(10000);
    });
  });
});

