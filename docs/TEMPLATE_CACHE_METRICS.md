# Template Cache Metrics & Monitoring

## Overview

The Template Cache Metrics system provides comprehensive tracking and alerting for content template cache performance. It monitors cache hits, misses, and new template creations, with automatic spike detection and detailed reporting.

## Features

### 1. Real-Time Metrics Tracking
- **Cache Hits**: Template found in memory, override, or database
- **Cache Misses**: Template not found, requires creation
- **Template Creations**: New templates created via Twilio Content API

### 2. Multi-Level Cache Tracking
- **Memory Cache**: In-process Map for fastest access
- **Override Cache**: Environment variable overrides (CONTENT_SID_*)
- **Database Cache**: Persistent cache with usage tracking

### 3. Automatic Spike Detection
- Monitors cache miss rate in 5-minute rolling window
- Alerts when miss rate exceeds 50% threshold
- Identifies problematic cache keys

### 4. Comprehensive Reporting
- Cumulative metrics since startup
- Time-windowed metrics
- Per-key breakdown
- Database cache statistics
- Health indicators

## Architecture

### Metrics Flow

```
Template Request
     ↓
Check Memory Cache → HIT? → Record Hit (memory)
     ↓ MISS
Check Override → HIT? → Record Hit (override)
     ↓ MISS
Check Database → HIT? → Record Hit (database)
     ↓ MISS
Record Miss
     ↓
Create Template → Record Creation
     ↓
Update Caches
```

### Data Structure

```typescript
interface CacheEvent {
  timestamp: Date;
  key: string;              // 'welcome', 'categories', etc.
  eventType: 'hit' | 'miss' | 'creation';
  dataHash?: string;        // Hash of template data
  templateSid?: string;     // Twilio Content SID
  metadata?: Record<string, any>;
}

interface CacheMetrics {
  hits: number;
  misses: number;
  creations: number;
  hitRate: number;          // hits / (hits + misses)
  missRate: number;         // misses / (hits + misses)
  totalRequests: number;
}
```

## Configuration

### Environment Variables

```bash
# No specific environment variables required
# Metrics automatically track all cache operations
```

### Hardcoded Parameters
- **Rolling Window**: 5 minutes (300,000ms)
- **Spike Threshold**: 50% miss rate
- **Max Events Tracked**: 10,000 recent events
- **Logging Interval**: 5 minutes

## Usage

### Automatic Tracking

Metrics are automatically tracked when using the cache:

```typescript
import { getCachedContentSid } from './workflows/cache';

// This automatically records hit/miss/creation metrics
const contentSid = await getCachedContentSid(
  'welcome',
  async () => createWelcomeTemplate(),
  'Welcome to our restaurant!',
  { dataSignature: 'v1.0' }
);
```

### Manual Tracking (Advanced)

```typescript
import { 
  recordCacheHit, 
  recordCacheMiss, 
  recordCacheCreation 
} from './services/templateCacheMetrics';

// Record a cache hit
recordCacheHit('categories', 'hash123', 'sid123', {
  source: 'database',
  friendlyName: 'Categories Menu',
});

// Record a cache miss
recordCacheMiss('order_type', 'hash456', {
  friendlyName: 'Order Type Selection',
});

// Record template creation
recordCacheCreation('cart_options', 'hash789', 'sid789', {
  friendlyName: 'Cart Actions',
});
```

## Monitoring

### Metrics API

#### Get Current Metrics

```bash
curl http://localhost:3000/api/cache/metrics
```

#### Response Structure

```json
{
  "runtime": {
    "cumulative": {
      "hits": 1250,
      "misses": 35,
      "creations": 35,
      "hitRate": 0.9728,
      "missRate": 0.0272,
      "totalRequests": 1285
    },
    "window": {
      "durationMs": 300000,
      "metrics": {
        "hits": 45,
        "misses": 2,
        "creations": 2,
        "hitRate": 0.9574,
        "missRate": 0.0426,
        "totalRequests": 47
      }
    },
    "byKey": {
      "welcome": {
        "hits": 234,
        "misses": 1,
        "creations": 1,
        "hitRate": 0.9957,
        "missRate": 0.0043,
        "totalRequests": 235
      },
      "categories": {
        "hits": 189,
        "misses": 5,
        "creations": 5,
        "hitRate": 0.9742,
        "missRate": 0.0258,
        "totalRequests": 194
      }
    }
  },
  "database": {
    "totalTemplates": 42,
    "templatesByKey": [
      { "key": "welcome", "_count": { "key": 3 } },
      { "key": "categories", "_count": { "key": 5 } }
    ],
    "recentlyUsed": [
      {
        "key": "welcome",
        "dataHash": "abc123",
        "templateSid": "HX1234567890abcdef",
        "friendlyName": "Welcome Message",
        "createdAt": "2025-10-21T10:00:00Z",
        "lastUsedAt": "2025-10-21T12:30:00Z"
      }
    ],
    "staleTemplates": [
      {
        "key": "old_menu",
        "dataHash": "xyz789",
        "templateSid": "HX0987654321fedcba",
        "friendlyName": "Old Menu",
        "createdAt": "2025-09-15T08:00:00Z",
        "lastUsedAt": "2025-09-20T14:00:00Z"
      }
    ]
  },
  "health": {
    "cumulativeHitRate": 0.9728,
    "windowHitRate": 0.9574,
    "missRateAboveThreshold": false,
    "threshold": 0.5
  }
}
```

### Automatic Logging

The system logs cache metrics every 5 minutes:

```
📊 [CacheMetrics] Summary:
   Cumulative: 1250 hits, 35 misses, 35 creations
   Hit rate: 97.3%
   Recent window (300s): 95.7% hit rate
   Top keys by usage:
      - welcome: 235 requests (99.6% hit rate)
      - categories: 194 requests (97.4% hit rate)
      - order_type: 156 requests (96.8% hit rate)
```

### Event-Level Logging

Each cache operation is logged:

```
📊 [CacheMetrics] HIT - welcome (hash: abc12345..., sid: HX123456)
⚠️ [CacheMetrics] MISS - categories (hash: xyz78901...)
🆕 [CacheMetrics] CREATION - categories (hash: xyz78901..., sid: HX789012)
```

### Spike Alerts

When miss rate exceeds threshold:

```
🚨 [CacheMetrics] ALERT: Cache miss spike detected!
   Miss rate: 65.3% (32/49 requests in last 300s)
🚨 [CacheMetrics] Top keys with high miss rates:
   - cart_options: 80.0% miss rate (8/10 requests)
   - payment_options: 75.0% miss rate (6/8 requests)
   - location_request: 60.0% miss rate (3/5 requests)
```

## Metrics Interpretation

### Hit Rate Guidelines

- **>95%**: Excellent - cache is working optimally
- **90-95%**: Good - normal operation
- **80-90%**: Fair - may need optimization
- **<80%**: Poor - investigate cache configuration

### Common Scenarios

#### High Hit Rate (>95%)
```
✅ Cache is effective
✅ Templates are being reused
✅ Data signatures are stable
```

#### High Miss Rate (>50%)
```
⚠️ Possible issues:
- Frequently changing template data (unstable hashes)
- New deployment cleared in-memory cache
- Database cache not populated
- Cache keys not properly configured
```

#### Many Creations
```
ℹ️ Indicates:
- First-time template usage
- New menu items/categories
- Template data variations
- Cache was recently cleared
```

## Troubleshooting

### High Cache Miss Rate

#### Investigation Steps

1. **Check per-key metrics**:
   ```bash
   curl http://localhost:3000/api/cache/metrics | jq '.runtime.byKey'
   ```

2. **Identify problematic keys**:
   - Keys with miss rate >30% need attention
   - Check if data signature changes frequently

3. **Review template data**:
   ```typescript
   // Ensure data signatures are stable
   const dataSignature = hashTemplateData(menuItems);
   ```

4. **Check environment overrides**:
   ```bash
   env | grep CONTENT_SID
   ```

### Cache Not Persisting

1. **Check database connection**:
   ```bash
   bunx prisma studio
   # Verify ContentTemplateCache table exists
   ```

2. **Check for skipPersist flag**:
   ```typescript
   // Don't use skipPersist in production
   getCachedContentSid(key, creator, { skipPersist: true }); // ❌
   ```

3. **Verify migrations**:
   ```bash
   bunx prisma migrate status
   bunx prisma migrate deploy
   ```

### Spike Alerts Triggering Frequently

#### Root Causes

1. **Unstable data hashes**:
   ```typescript
   // ❌ Bad: includes timestamp (always changes)
   const hash = hashData({ items, timestamp: Date.now() });
   
   // ✅ Good: stable data only
   const hash = hashData({ items });
   ```

2. **Cache cleared frequently**:
   - Check if server restarts often
   - Verify Redis persistence
   - Ensure database cache is populated

3. **New templates**:
   - Normal during initial deployment
   - Expected when adding new features

### Memory Usage Concerns

The system automatically trims events to max 10,000:

```typescript
// Automatic trimming
if (recentEvents.length > MAX_EVENTS) {
  recentEvents.shift(); // Remove oldest
}
```

## Performance Impact

### Overhead
- **Recording**: ~0.1ms per event
- **Retrieval**: ~1ms for metrics API
- **Memory**: ~200KB for 10k events
- **Logging**: Minimal (async)

### Optimization

```typescript
// Disable logging in high-throughput scenarios
stopMetricsLogging();

// Re-enable when needed
startMetricsLogging(300000); // 5 minutes
```

## Testing

### Unit Tests

```bash
bun test:cache
```

### Test Coverage

- ✅ Basic metrics tracking (hits, misses, creations)
- ✅ Window-based metrics
- ✅ Per-key metrics
- ✅ Spike detection
- ✅ Database cache stats
- ✅ Comprehensive reporting
- ✅ Metadata integrity
- ✅ High-volume scenarios
- ✅ Edge cases

### Manual Testing

```typescript
import { 
  recordCacheHit, 
  recordCacheMiss, 
  getCacheMetrics,
  resetMetrics 
} from './services/templateCacheMetrics';

// Reset for clean test
resetMetrics();

// Simulate cache operations
recordCacheHit('test', 'hash1', 'sid1');
recordCacheHit('test', 'hash1', 'sid1');
recordCacheMiss('test', 'hash2');

// Check metrics
const metrics = getCacheMetrics();
console.log(metrics);
// Output: { hits: 2, misses: 1, hitRate: 0.667, ... }
```

## Best Practices

### 1. Stable Data Signatures

```typescript
// ✅ Good: Sort arrays for consistent hashing
const items = menuItems.sort((a, b) => a.id.localeCompare(b.id));
const hash = hashData(items);

// ❌ Bad: Unsorted arrays can produce different hashes
const hash = hashData(menuItems);
```

### 2. Meaningful Cache Keys

```typescript
// ✅ Good: Descriptive keys
getCachedContentSid('welcome_message', ...);
getCachedContentSid('menu_categories', ...);

// ❌ Bad: Generic keys
getCachedContentSid('content1', ...);
getCachedContentSid('template', ...);
```

### 3. Regular Monitoring

```typescript
// Set up alerts
setInterval(async () => {
  const report = await getCacheReport();
  
  if (report.health.missRateAboveThreshold) {
    await alertOps('Cache miss rate above threshold');
  }
}, 60000); // Check every minute
```

### 4. Cache Warmup

```typescript
// Warm up cache on startup
const criticalKeys = ['welcome', 'categories', 'order_type'];

for (const key of criticalKeys) {
  await getCachedContentSid(key, createTemplate);
}
```

## Integration with Monitoring Tools

### Prometheus Metrics

```typescript
// Export metrics in Prometheus format
app.get('/metrics', async (req, res) => {
  const metrics = getCacheMetrics();
  
  res.send(`
# HELP cache_hits_total Total cache hits
# TYPE cache_hits_total counter
cache_hits_total ${metrics.hits}

# HELP cache_misses_total Total cache misses
# TYPE cache_misses_total counter
cache_misses_total ${metrics.misses}

# HELP cache_hit_rate Current cache hit rate
# TYPE cache_hit_rate gauge
cache_hit_rate ${metrics.hitRate}
  `);
});
```

### Datadog Integration

```typescript
import { StatsD } from 'node-dogstatsd';
const statsd = new StatsD();

// Track metrics
recordCacheHit('key', 'hash', 'sid');
statsd.increment('cache.hits', 1, ['key:key']);
```

## Future Enhancements

- [ ] Configurable spike thresholds per key
- [ ] Cache efficiency scoring
- [ ] Historical trend analysis
- [ ] Automatic cache warmup strategies
- [ ] Integration with external monitoring
- [ ] Cache invalidation recommendations
- [ ] Cost analysis (Twilio API calls saved)

## Support

For issues or questions:
1. Check metrics at `/api/cache/metrics`
2. Review logs for spike alerts
3. Run unit tests: `bun test:cache`
4. Verify database cache population
5. Contact support with specific cache keys

