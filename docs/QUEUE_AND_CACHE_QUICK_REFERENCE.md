# WhatsApp Queue & Cache Metrics - Quick Reference

## 🚀 Quick Start

### Start Worker
```bash
bun run worker:send
```

### Run Tests
```bash
bun test:queue          # Queue tests
bun test:queue:load     # Load tests
bun test:cache          # Cache tests
```

### Get Metrics
```bash
curl http://localhost:3000/api/cache/metrics
```

---

## 📤 WhatsApp Send Queue

### Send Message (API)
```bash
curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+966500000000", "text": "Hello!"}'
```

### Send Message (Code)
```typescript
import { enqueueWhatsAppSend } from './src/redis/whatsappSendQueue';

const job = await enqueueWhatsAppSend({
  restaurantId: 'r1',
  conversationId: 'c1',
  phoneNumber: '+966500000000',
  text: 'Your order is ready!',
  fromNumber: 'whatsapp:+14155238886',
}, 10); // Priority (0-10, higher = first)
```

### Get Queue Metrics
```typescript
import { getQueueMetrics } from './src/redis/whatsappSendQueue';

const metrics = await getQueueMetrics();
// Returns: { waiting, active, completed, failed, delayed, tenantConcurrency }
```

### Environment Variables
```bash
WHATSAPP_SEND_QUEUE_ENABLED=true  # Enable/disable queue
WHATSAPP_SEND_QUEUE_NAME=whatsapp-send
REDIS_URL=redis://localhost:6379
QUEUE_RETRY_ATTEMPTS=3
QUEUE_BACKOFF_DELAY=2000
```

### Key Limits
- **Per-Tenant Concurrency**: 5 messages
- **Global Rate Limit**: 80 messages/second
- **Retry Attempts**: 3
- **Backoff Delay**: 2 seconds (exponential)

---

## 📊 Template Cache Metrics

### Automatic Tracking
```typescript
import { getCachedContentSid } from './src/workflows/cache';

// Metrics automatically recorded
const sid = await getCachedContentSid('welcome', creator);
```

### Manual Tracking
```typescript
import { 
  recordCacheHit, 
  recordCacheMiss, 
  recordCacheCreation 
} from './src/services/templateCacheMetrics';

recordCacheHit('key', 'hash123', 'sid123', { source: 'database' });
recordCacheMiss('key', 'hash456');
recordCacheCreation('key', 'hash789', 'sid789');
```

### Get Metrics
```typescript
import { 
  getCacheMetrics,
  getCacheReport 
} from './src/services/templateCacheMetrics';

const metrics = getCacheMetrics();
// Returns: { hits, misses, creations, hitRate, missRate, totalRequests }

const report = await getCacheReport();
// Returns: { runtime, database, health }
```

### Metrics API
```bash
curl http://localhost:3000/api/cache/metrics | jq
```

### Key Thresholds
- **Good Hit Rate**: >95%
- **Fair Hit Rate**: 90-95%
- **Poor Hit Rate**: <80%
- **Spike Alert**: >50% miss rate in 5-minute window

---

## 🔍 Monitoring

### Queue Health
```bash
# Check worker
ps aux | grep whatsappSendWorker

# Check Redis
redis-cli ping

# View queue metrics
curl http://localhost:3000/api/queue/metrics
```

### Cache Health
```bash
# View cache metrics
curl http://localhost:3000/api/cache/metrics

# Check logs for spike alerts
tail -f logs/app.log | grep "🚨"
```

### Logs to Watch

#### Queue Logs
```
📤 Enqueued job abc-123 for restaurant r1
🔄 Processing job abc-123 for restaurant r1
✅ Job abc-123 completed: SM1234567890
📊 Metrics: { waiting: 5, active: 3, ... }
```

#### Cache Logs
```
📊 HIT - welcome (hash: abc12345..., sid: HX123456)
⚠️ MISS - categories (hash: xyz78901...)
🆕 CREATION - categories (hash: xyz78901..., sid: HX789012)
🚨 ALERT: Cache miss spike detected! Miss rate: 65.3%
```

---

## 🛠️ Troubleshooting

### Queue Issues

**Queue not processing?**
```bash
# Check worker
ps aux | grep whatsappSendWorker

# Restart worker
pkill -f whatsappSendWorker
bun run worker:send
```

**High failure rate?**
```bash
# Check failed jobs
redis-cli LRANGE bull:whatsapp-send:failed 0 10

# Check Twilio credentials
bunx prisma studio  # Verify restaurant.twilioAccountSid
```

**Messages stuck?**
```typescript
// Manually retry stalled jobs
const stalledJobs = await whatsappSendQueue.getJobs(['stalled']);
for (const job of stalledJobs) {
  await job.retry();
}
```

### Cache Issues

**High miss rate?**
```bash
# Check per-key metrics
curl http://localhost:3000/api/cache/metrics | jq '.runtime.byKey'

# Verify data signatures are stable
# Ensure templates aren't recreated unnecessarily
```

**Cache not persisting?**
```bash
# Check database
bunx prisma studio

# Verify migrations
bunx prisma migrate status
bunx prisma migrate deploy
```

**Memory concerns?**
```typescript
// Events auto-trim at 10k
// Check current count via metrics API
```

---

## 📈 Performance

### Queue Performance
- **Enqueue**: <50ms
- **Processing**: <5s end-to-end
- **Throughput**: 80 msg/sec globally

### Cache Performance
- **Recording**: ~0.1ms overhead
- **API Retrieval**: ~1ms
- **Memory**: ~200KB for 10k events

---

## 🧪 Testing

### Run All Tests
```bash
bun test                # All tests
bun test:queue          # Queue basic tests
bun test:queue:load     # Queue load tests
bun test:cache          # Cache metrics tests
```

### Test Scenarios

#### Queue Load Tests
- ✅ Burst: 100 messages in <5s
- ✅ Concurrency: 50 messages, max 5 concurrent
- ✅ FIFO: 20 messages ordered
- ✅ Multi-tenant: 100 messages across 10 tenants
- ✅ Sustained: 10 msg/sec for 5s
- ✅ Rate limit: 150 messages

#### Cache Tests
- ✅ Basic tracking (hits, misses, creations)
- ✅ Window metrics
- ✅ Per-key metrics
- ✅ Spike detection
- ✅ Metadata integrity
- ✅ High volume (20k events)

---

## 🎯 Best Practices

### Queue Best Practices

```typescript
// ✅ Use priority for important messages
await enqueueWhatsAppSend(urgentMessage, 10);
await enqueueWhatsAppSend(normalMessage, 5);

// ✅ Stagger bulk sends
for (const customer of customers) {
  await enqueueWhatsAppSend(message);
  await sleep(100); // 100ms delay
}

// ✅ Monitor queue health
const metrics = await getQueueMetrics();
if (metrics.failed > metrics.completed * 0.05) {
  alertOps('High failure rate');
}
```

### Cache Best Practices

```typescript
// ✅ Stable data signatures
const items = menuItems.sort((a, b) => a.id.localeCompare(b.id));
const hash = hashData(items);

// ✅ Meaningful cache keys
getCachedContentSid('welcome_message', ...);
getCachedContentSid('menu_categories', ...);

// ✅ Warm up critical templates
const criticalKeys = ['welcome', 'categories', 'order_type'];
for (const key of criticalKeys) {
  await getCachedContentSid(key, createTemplate);
}
```

---

## 🔧 Configuration

### Enable/Disable Queue
```bash
# Enable (default)
export WHATSAPP_SEND_QUEUE_ENABLED=true

# Disable (rollback)
export WHATSAPP_SEND_QUEUE_ENABLED=false
```

### Adjust Logging
```typescript
// Start/stop cache metrics logging
import { startMetricsLogging, stopMetricsLogging } from './services/templateCacheMetrics';

startMetricsLogging(300000); // 5 minutes
stopMetricsLogging();
```

---

## 📚 Full Documentation

- **[WhatsApp Send Queue](./WHATSAPP_SEND_QUEUE.md)** - Complete queue guide
- **[Template Cache Metrics](./TEMPLATE_CACHE_METRICS.md)** - Complete cache guide
- **[Implementation Summary](./QUEUE_AND_CACHE_IMPLEMENTATION_SUMMARY.md)** - Technical details

---

## 🆘 Support

**Need help?**
1. Check logs for errors
2. Review metrics at `/api/cache/metrics`
3. Run tests: `bun test:queue && bun test:cache`
4. Check documentation in `/docs`
5. Contact support with:
   - Job IDs (for queue issues)
   - Cache keys (for cache issues)
   - Log excerpts

**Emergency rollback:**
```bash
export WHATSAPP_SEND_QUEUE_ENABLED=false
```

---

## ✅ Checklist

### Deployment Checklist
- [ ] Redis server running
- [ ] Database migrations applied
- [ ] Worker process started
- [ ] Environment variables configured
- [ ] Monitoring endpoints accessible
- [ ] Tests passing
- [ ] Logs configured

### Health Check Checklist
- [ ] Queue metrics show reasonable numbers
- [ ] Cache hit rate >90%
- [ ] No spike alerts in logs
- [ ] Worker process running
- [ ] Failed jobs <1% of total
- [ ] Response times normal

---

**Last Updated**: October 21, 2025

