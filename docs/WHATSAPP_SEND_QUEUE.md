# WhatsApp Send Queue

## Overview

The WhatsApp Send Queue provides a robust, FIFO-ordered message queueing system for the `/api/whatsapp/send` endpoint. It ensures messages are delivered in order per conversation while maintaining per-tenant concurrency controls to prevent rate limit issues.

## Features

### 1. FIFO Ordering per Conversation
Messages to the same conversation are guaranteed to be delivered in the order they were enqueued. This is critical for maintaining context in customer interactions.

### 2. Per-Tenant Concurrency Control
Each restaurant can have a maximum of 5 concurrent message sends at any time. This prevents any single tenant from overwhelming the system or hitting Twilio rate limits.

### 3. Global Rate Limiting
The queue enforces a global rate limit of 80 messages per second across all tenants, safely below Twilio's 100/second limit.

### 4. Automatic Retries
Failed messages are automatically retried up to 3 times with exponential backoff (2 seconds initial delay).

### 5. Queue Metrics & Monitoring
Real-time metrics are available to track queue health, tenant-specific activity, and message delivery status.

## Architecture

### Queue Structure
```
Restaurant A + Conversation 1 → [Msg1, Msg2, Msg3] (FIFO)
Restaurant A + Conversation 2 → [Msg4, Msg5] (FIFO)
Restaurant B + Conversation 1 → [Msg6, Msg7] (FIFO)
```

Each conversation gets its own FIFO ordering guarantee, while the global system processes messages based on:
1. Priority (higher priority first)
2. FIFO within same priority
3. Tenant concurrency limits

### Components

1. **Queue** (`whatsappSendQueue`): BullMQ queue backed by Redis
2. **Worker** (`whatsappSendWorker.ts`): Background worker that processes queued messages
3. **API Integration** (`notify.ts`): Routes messages through queue when enabled

## Configuration

### Environment Variables

```bash
# Queue Configuration
WHATSAPP_SEND_QUEUE_ENABLED=true  # Enable/disable queue (default: true)
WHATSAPP_SEND_QUEUE_NAME=whatsapp-send  # Queue name in Redis
REDIS_URL=redis://localhost:6379  # Redis connection

# Queue Behavior
QUEUE_RETRY_ATTEMPTS=3  # Number of retry attempts for failed messages
QUEUE_BACKOFF_DELAY=2000  # Initial backoff delay in milliseconds
```

### Queue Parameters (Hardcoded)
- **Max Concurrency per Tenant**: 5 parallel sends
- **Global Rate Limit**: 80 messages/second
- **Global Concurrency**: 20 parallel jobs across all tenants

## Usage

### Starting the Worker

```bash
# Production
bun run worker:send

# Development (with auto-reload)
bun run worker:send:dev
```

### Sending Messages

#### Via API
```bash
curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+966500000000",
    "text": "Hello from queued system!",
    "fromNumber": "whatsapp:+14155238886"
  }'
```

#### Response (Queued)
```json
{
  "status": "queued",
  "message": "Message queued for delivery",
  "jobId": "restaurant-abc:conversation-xyz-1729512345678-a1b2c3",
  "queuePosition": "waiting"
}
```

#### Response (Direct Send - Fallback)
```json
{
  "status": "ok",
  "message": "Successfully sent",
  "channel": "template",
  "sid": "SM1234567890abcdef"
}
```

### Programmatic Usage

```typescript
import { enqueueWhatsAppSend } from './src/redis/whatsappSendQueue';

// Enqueue a message
const job = await enqueueWhatsAppSend({
  restaurantId: 'restaurant-123',
  conversationId: 'conversation-456',
  phoneNumber: '+966500000000',
  text: 'Your order is ready!',
  fromNumber: 'whatsapp:+14155238886',
}, 10); // Priority: 10 (higher = processed first)

console.log(`Job queued: ${job.id}`);
```

## Monitoring

### Queue Metrics API

```bash
# Get queue metrics
curl http://localhost:3000/api/queue/metrics
```

#### Response
```json
{
  "waiting": 15,
  "active": 8,
  "completed": 1250,
  "failed": 3,
  "delayed": 0,
  "tenantConcurrency": {
    "restaurant-abc": 3,
    "restaurant-xyz": 2,
    "restaurant-123": 3
  },
  "maxConcurrencyPerTenant": 5
}
```

### Worker Logs

The worker logs detailed information every 30 seconds:

```
📊 [WhatsAppSendQueue] Metrics: {
  waiting: 5,
  active: 3,
  completed: 1250,
  failed: 0,
  delayed: 0,
  tenantCount: 3,
  tenantConcurrency: { 'restaurant-abc': 3 }
}
```

### Job Logs

Individual job processing is logged:

```
📤 [WhatsAppSendQueue] Enqueued job abc-123 for restaurant r1 to +966500000000
🔄 [WhatsAppSendQueue] Processing job abc-123 for restaurant r1
✅ [WhatsAppSendQueue] Job abc-123 completed: SM1234567890
```

## Load Testing

### Running Load Tests

```bash
# Basic queue tests
bun test:queue

# Load tests (burst traffic, concurrency, sustained load)
bun test:queue:load
```

### Load Test Scenarios

1. **Burst Traffic**: 100 messages enqueued rapidly
2. **Per-Tenant Concurrency**: 50 messages from same restaurant
3. **FIFO Ordering**: 20 messages to same conversation
4. **Multi-Tenant**: 100 messages across 10 tenants
5. **Sustained Load**: 10 messages/second for 5 seconds
6. **Rate Limit Recovery**: 150 messages to test rate limiting

## Troubleshooting

### Queue Not Processing Messages

1. **Check worker is running**:
   ```bash
   ps aux | grep whatsappSendWorker
   ```

2. **Check Redis connection**:
   ```bash
   redis-cli ping
   ```

3. **Check worker logs** for errors

### High Failure Rate

1. **Check Twilio credentials** in restaurant configuration
2. **Verify phone number formats** (should be E.164)
3. **Check quota limits** - may be hitting restaurant limits
4. **Review failed jobs** in Redis:
   ```bash
   redis-cli LRANGE bull:whatsapp-send:failed 0 10
   ```

### Tenant Hitting Concurrency Limits

If a tenant frequently hits the 5-message concurrency limit:

1. **Check message volume** - may need rate limiting at application level
2. **Review message patterns** - bulk sends should be staggered
3. **Consider increasing limit** in `whatsappSendQueue.ts` (carefully)

### Messages Stuck in Queue

1. **Check for stalled jobs**:
   ```typescript
   const stalledJobs = await whatsappSendQueue.getJobs(['stalled']);
   ```

2. **Manually retry**:
   ```typescript
   for (const job of stalledJobs) {
     await job.retry();
   }
   ```

3. **Clear dead jobs** (use carefully):
   ```typescript
   await whatsappSendQueue.clean(0, 'failed');
   ```

## Performance Characteristics

### Throughput
- **Burst**: Can enqueue 100+ messages in <5 seconds
- **Sustained**: Processes ~80 messages/second globally
- **Per-Tenant**: Up to 5 messages simultaneously per restaurant

### Latency
- **Enqueue Time**: <50ms per message
- **Processing Start**: <2 seconds for high-priority messages
- **End-to-End**: Typically <5 seconds from enqueue to Twilio delivery

### Resource Usage
- **Memory**: ~50MB base + ~1KB per queued message
- **Redis**: ~2KB per message in queue
- **CPU**: Low (<5% idle, <30% under load)

## Best Practices

### 1. Priority Management
```typescript
// High priority (customer service)
await enqueueWhatsAppSend(message, 10);

// Normal priority (marketing)
await enqueueWhatsAppSend(message, 5);

// Low priority (notifications)
await enqueueWhatsAppSend(message, 0);
```

### 2. Error Handling
```typescript
try {
  const job = await enqueueWhatsAppSend(message);
  // Track job ID for status checks
  await logJobId(job.id);
} catch (error) {
  // Queue failure - implement fallback
  await sendDirectly(message);
}
```

### 3. Bulk Sends
```typescript
// Stagger bulk sends to avoid overwhelming queue
for (const customer of customers) {
  await enqueueWhatsAppSend({ ...message, phoneNumber: customer.phone });
  await sleep(100); // 100ms delay between enqueues
}
```

### 4. Monitoring
```typescript
// Check queue health regularly
const metrics = await getQueueMetrics();
if (metrics.failed > metrics.completed * 0.05) {
  alertOps('High failure rate in WhatsApp queue');
}
```

## Migration Guide

### From Direct Send to Queue

**Before:**
```typescript
const result = await sendNotification(twilioClient, phone, text);
```

**After:**
```typescript
const job = await enqueueWhatsAppSend({
  restaurantId,
  conversationId,
  phoneNumber: phone,
  text,
});
```

### Disabling Queue (Rollback)

Set environment variable:
```bash
WHATSAPP_SEND_QUEUE_ENABLED=false
```

The system will automatically fall back to direct sends.

## Future Enhancements

- [ ] Per-tenant rate limit configuration
- [ ] Dead letter queue for permanently failed messages
- [ ] Queue analytics dashboard
- [ ] Message deduplication
- [ ] Scheduled message delivery
- [ ] Priority queues per message type

## Support

For issues or questions:
1. Check logs in `src/workers/whatsappSendWorker.ts`
2. Review queue metrics at `/api/queue/metrics`
3. Run load tests to verify behavior
4. Contact support with job IDs for debugging

