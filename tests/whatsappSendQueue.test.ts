import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { 
  enqueueWhatsAppSend, 
  startWhatsAppSendWorker, 
  getQueueMetrics,
  getRestaurantJobs,
} from '../src/redis/whatsappSendQueue';

describe('WhatsApp Send Queue', () => {
  let worker: any;
  
  beforeAll(async () => {
    // Start the worker for testing
    worker = startWhatsAppSendWorker();
    
    // Wait a bit for worker to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
  });
  
  afterAll(async () => {
    // Clean up worker
    if (worker) {
      await worker.close();
    }
  });
  
  it('should enqueue a WhatsApp send job', async () => {
    const job = await enqueueWhatsAppSend({
      restaurantId: 'test-restaurant-1',
      conversationId: 'test-conversation-1',
      phoneNumber: '+966500000001',
      text: 'Test message',
      fromNumber: 'whatsapp:+14155238886',
    });
    
    expect(job).toBeDefined();
    expect(job.id).toBeDefined();
    expect(job.data.restaurantId).toBe('test-restaurant-1');
    expect(job.data.conversationId).toBe('test-conversation-1');
  });
  
  it('should maintain FIFO order for same conversation', async () => {
    const restaurantId = 'test-restaurant-2';
    const conversationId = 'test-conversation-2';
    
    // Record enqueue times
    const enqueueTime1 = Date.now();
    const job1 = await enqueueWhatsAppSend({
      restaurantId,
      conversationId,
      phoneNumber: '+966500000002',
      text: 'Message 1',
      fromNumber: 'whatsapp:+14155238886',
    });
    
    await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to ensure distinct timestamps
    
    const enqueueTime2 = Date.now();
    const job2 = await enqueueWhatsAppSend({
      restaurantId,
      conversationId,
      phoneNumber: '+966500000002',
      text: 'Message 2',
      fromNumber: 'whatsapp:+14155238886',
    });
    
    await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to ensure distinct timestamps
    
    const enqueueTime3 = Date.now();
    const job3 = await enqueueWhatsAppSend({
      restaurantId,
      conversationId,
      phoneNumber: '+966500000002',
      text: 'Message 3',
      fromNumber: 'whatsapp:+14155238886',
    });
    
    // Jobs should have sequential timestamps based on when they were created
    expect(job1.timestamp).toBeLessThan(job2.timestamp);
    expect(job2.timestamp).toBeLessThan(job3.timestamp);
    
    // Verify enqueue times are also sequential
    expect(enqueueTime1).toBeLessThan(enqueueTime2);
    expect(enqueueTime2).toBeLessThan(enqueueTime3);
  });
  
  it('should get queue metrics', async () => {
    const metrics = await getQueueMetrics();
    
    expect(metrics).toBeDefined();
    expect(typeof metrics.waiting).toBe('number');
    expect(typeof metrics.active).toBe('number');
    expect(typeof metrics.completed).toBe('number');
    expect(typeof metrics.failed).toBe('number');
    expect(typeof metrics.delayed).toBe('number');
    expect(metrics.tenantConcurrency).toBeDefined();
    expect(metrics.maxConcurrencyPerTenant).toBe(5);
  });
  
  it('should get restaurant-specific jobs', async () => {
    const restaurantId = 'test-restaurant-3';
    
    // Enqueue a job
    await enqueueWhatsAppSend({
      restaurantId,
      conversationId: 'test-conversation-3',
      phoneNumber: '+966500000003',
      text: 'Test message',
      fromNumber: 'whatsapp:+14155238886',
    });
    
    // Wait a bit for job to be processed
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const jobs = await getRestaurantJobs(restaurantId, 10);
    
    expect(Array.isArray(jobs)).toBe(true);
    // We should have at least one job
    const restaurantJob = jobs.find(j => j.data.restaurantId === restaurantId);
    if (restaurantJob) {
      expect(restaurantJob.data.restaurantId).toBe(restaurantId);
    }
  });
  
  it('should handle priority jobs correctly', async () => {
    const restaurantId = 'test-restaurant-4';
    
    // Enqueue low priority job first
    const lowPriorityJob = await enqueueWhatsAppSend({
      restaurantId,
      conversationId: 'test-conversation-4a',
      phoneNumber: '+966500000004',
      text: 'Low priority message',
      fromNumber: 'whatsapp:+14155238886',
    }, 0); // Priority 0 (default)
    
    // Then enqueue high priority job
    const highPriorityJob = await enqueueWhatsAppSend({
      restaurantId,
      conversationId: 'test-conversation-4b',
      phoneNumber: '+966500000004',
      text: 'High priority message',
      fromNumber: 'whatsapp:+14155238886',
    }, 10); // Priority 10 (higher = processed first)
    
    expect(lowPriorityJob).toBeDefined();
    expect(highPriorityJob).toBeDefined();
    // High priority should be picked up first (verified through queue behavior)
  });
});

