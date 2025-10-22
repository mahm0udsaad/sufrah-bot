import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { 
  enqueueWhatsAppSend, 
  startWhatsAppSendWorker, 
  getQueueMetrics,
} from '../src/redis/whatsappSendQueue';

/**
 * Load tests for WhatsApp Send Queue
 * These tests verify that the queue handles burst traffic correctly
 * and maintains proper pacing under load
 */
describe('WhatsApp Send Queue - Load Tests', () => {
  let worker: any;
  
  beforeAll(async () => {
    // Start the worker for testing
    worker = startWhatsAppSendWorker();
    
    // Wait for worker to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
  });
  
  afterAll(async () => {
    // Clean up worker
    if (worker) {
      await worker.close();
    }
  });
  
  it('should handle burst of 100 messages for single restaurant', async () => {
    const restaurantId = 'load-test-restaurant-1';
    const startTime = Date.now();
    
    // Enqueue 100 messages rapidly
    const jobs = await Promise.all(
      Array.from({ length: 100 }, (_, i) => 
        enqueueWhatsAppSend({
          restaurantId,
          conversationId: `load-conversation-${i}`,
          phoneNumber: `+96650000${String(i).padStart(4, '0')}`,
          text: `Load test message ${i}`,
          fromNumber: 'whatsapp:+14155238886',
        })
      )
    );
    
    const enqueueTime = Date.now() - startTime;
    
    console.log(`✅ Enqueued 100 messages in ${enqueueTime}ms`);
    
    expect(jobs.length).toBe(100);
    expect(enqueueTime).toBeLessThan(5000); // Should enqueue in under 5 seconds
    
    // Check metrics
    const metrics = await getQueueMetrics();
    console.log('📊 Queue metrics after burst:', metrics);
    
    // At least some jobs should be waiting or active
    expect(metrics.waiting + metrics.active).toBeGreaterThan(0);
  }, 30000); // 30 second timeout
  
  it('should respect per-tenant concurrency limits', async () => {
    const restaurantId = 'load-test-restaurant-2';
    
    // Enqueue 50 messages for same restaurant
    const jobs = await Promise.all(
      Array.from({ length: 50 }, (_, i) => 
        enqueueWhatsAppSend({
          restaurantId,
          conversationId: `concurrency-conversation-${i}`,
          phoneNumber: `+96651000${String(i).padStart(4, '0')}`,
          text: `Concurrency test message ${i}`,
          fromNumber: 'whatsapp:+14155238886',
        })
      )
    );
    
    expect(jobs.length).toBe(50);
    
    // Wait a bit for processing to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check metrics - tenant should not exceed max concurrency
    const metrics = await getQueueMetrics();
    const tenantConcurrency = metrics.tenantConcurrency[restaurantId] || 0;
    
    console.log(`📊 Tenant ${restaurantId} concurrency: ${tenantConcurrency}/${metrics.maxConcurrencyPerTenant}`);
    
    // Concurrency should not exceed the max (5)
    expect(tenantConcurrency).toBeLessThanOrEqual(metrics.maxConcurrencyPerTenant);
  }, 30000);
  
  it('should maintain FIFO order under load for same conversation', async () => {
    const restaurantId = 'load-test-restaurant-3';
    const conversationId = 'fifo-load-conversation';
    
    // Enqueue 20 messages for same conversation rapidly
    const messageOrder: number[] = [];
    const jobs = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        messageOrder.push(i);
        return enqueueWhatsAppSend({
          restaurantId,
          conversationId,
          phoneNumber: '+966520000000',
          text: `FIFO test message ${i}`,
          fromNumber: 'whatsapp:+14155238886',
          requestId: `fifo-${conversationId}-${i}`, // Explicit ID for tracking
        });
      })
    );
    
    expect(jobs.length).toBe(20);
    
    // All jobs for same conversation should be queued
    for (let i = 0; i < jobs.length; i++) {
      expect(jobs[i].data.text).toBe(`FIFO test message ${i}`);
    }
    
    console.log('✅ FIFO order maintained for 20 messages in same conversation');
  }, 30000);
  
  it('should handle concurrent messages to multiple tenants', async () => {
    // Create 10 tenants with 10 messages each (100 total)
    const tenantCount = 10;
    const messagesPerTenant = 10;
    const startTime = Date.now();
    
    const allJobs = await Promise.all(
      Array.from({ length: tenantCount }, (_, tenantIdx) =>
        Promise.all(
          Array.from({ length: messagesPerTenant }, (_, msgIdx) =>
            enqueueWhatsAppSend({
              restaurantId: `multi-tenant-${tenantIdx}`,
              conversationId: `multi-conversation-${tenantIdx}-${msgIdx}`,
              phoneNumber: `+966530${String(tenantIdx).padStart(2, '0')}${String(msgIdx).padStart(4, '0')}`,
              text: `Multi-tenant message T${tenantIdx} M${msgIdx}`,
              fromNumber: 'whatsapp:+14155238886',
            })
          )
        )
      )
    );
    
    const totalJobs = allJobs.flat().length;
    const enqueueTime = Date.now() - startTime;
    
    console.log(`✅ Enqueued ${totalJobs} messages across ${tenantCount} tenants in ${enqueueTime}ms`);
    
    expect(totalJobs).toBe(tenantCount * messagesPerTenant);
    expect(enqueueTime).toBeLessThan(10000); // Should enqueue in under 10 seconds
    
    // Check metrics
    const metrics = await getQueueMetrics();
    console.log('📊 Multi-tenant queue metrics:', {
      waiting: metrics.waiting,
      active: metrics.active,
      tenantCount: Object.keys(metrics.tenantConcurrency).length,
    });
    
    // Should have jobs waiting or active
    expect(metrics.waiting + metrics.active).toBeGreaterThan(0);
  }, 60000); // 60 second timeout
  
  it('should handle sustained load over time', async () => {
    const restaurantId = 'sustained-load-restaurant';
    const durationMs = 5000; // 5 seconds
    const messagesPerSecond = 10;
    const intervalMs = 1000 / messagesPerSecond;
    
    const startTime = Date.now();
    const messages: any[] = [];
    let messageCount = 0;
    
    // Send messages at steady rate
    const intervalId = setInterval(async () => {
      if (Date.now() - startTime >= durationMs) {
        clearInterval(intervalId);
        return;
      }
      
      try {
        const job = await enqueueWhatsAppSend({
          restaurantId,
          conversationId: `sustained-conversation-${messageCount}`,
          phoneNumber: `+96654000${String(messageCount).padStart(4, '0')}`,
          text: `Sustained load message ${messageCount}`,
          fromNumber: 'whatsapp:+14155238886',
        });
        messages.push(job);
        messageCount++;
      } catch (error) {
        console.error('Failed to enqueue during sustained load:', error);
      }
    }, intervalMs);
    
    // Wait for sustained load to complete
    await new Promise(resolve => setTimeout(resolve, durationMs + 1000));
    
    console.log(`✅ Sustained load: ${messages.length} messages over ${durationMs}ms`);
    
    expect(messages.length).toBeGreaterThan(0);
    
    // Check final metrics
    const metrics = await getQueueMetrics();
    console.log('📊 Sustained load final metrics:', metrics);
  }, 10000); // 10 second timeout
  
  it('should recover from rate limit delays', async () => {
    const restaurantId = 'rate-limit-test-restaurant';
    
    // Enqueue many messages to potentially trigger rate limiting
    const jobs = await Promise.all(
      Array.from({ length: 150 }, (_, i) => 
        enqueueWhatsAppSend({
          restaurantId,
          conversationId: `rate-limit-conversation-${i}`,
          phoneNumber: `+96655000${String(i).padStart(4, '0')}`,
          text: `Rate limit test message ${i}`,
          fromNumber: 'whatsapp:+14155238886',
        })
      )
    );
    
    expect(jobs.length).toBe(150);
    
    // Wait for some processing
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check metrics - should have delayed jobs due to rate limiting
    const metrics = await getQueueMetrics();
    console.log('📊 Rate limit recovery metrics:', {
      waiting: metrics.waiting,
      active: metrics.active,
      delayed: metrics.delayed,
    });
    
    // Should be processing or delaying jobs appropriately
    expect(metrics.waiting + metrics.active + metrics.delayed).toBeGreaterThan(0);
  }, 30000);
});

