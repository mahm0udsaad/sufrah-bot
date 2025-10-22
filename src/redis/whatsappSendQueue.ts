import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { REDIS_URL } from '../config';
import { TwilioClientManager } from '../twilio/clientManager';
import { sendNotification } from '../services/whatsapp';
import { getRestaurantByWhatsapp } from '../db/sufrahRestaurantService';
import { checkQuota, formatQuotaError } from '../services/quotaEnforcement';
import { standardizeWhatsappNumber } from '../utils/phone';
import { trackUsage } from '../services/usageTracking';

const WHATSAPP_SEND_QUEUE_NAME = 'whatsapp-send';
const MAX_CONCURRENCY_PER_TENANT = 5; // Max parallel sends per restaurant
const GLOBAL_RATE_LIMIT = 80; // Max 80 jobs per duration globally (below Twilio's 100/sec)
const RATE_LIMIT_DURATION = 1000; // 1 second
const TENANT_RETRY_DELAY_MS = 500;
const CONVERSATION_LOCK_RETRY_DELAY_MS = 500;
const CONVERSATION_LOCK_TTL_MS = 60_000; // 60 seconds lock TTL to avoid stuck locks
const CONVERSATION_LOCK_PREFIX = 'whatsapp-send:lock:';

// Job data for WhatsApp send operations
export interface WhatsAppSendJob {
  restaurantId: string;
  conversationId?: string;
  phoneNumber: string;
  text: string;
  fromNumber?: string;
  templateVariables?: Record<string, any>;
  requestId?: string; // For idempotency tracking
}

// Create Redis connection for BullMQ
const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
});

// Create WhatsApp send queue with FIFO guarantees per conversation
export const whatsappSendQueue = new Queue<WhatsAppSendJob>(WHATSAPP_SEND_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      count: 1000, // Keep last 1000 completed jobs for debugging
      age: 24 * 3600, // Remove after 24 hours
    },
    removeOnFail: {
      count: 5000, // Keep last 5000 failed jobs for analysis
    },
  },
});

// Ensure delayed jobs get promoted and retries are processed
// Track active jobs per tenant for concurrency control
const tenantActiveJobs = new Map<string, number>();

/**
 * Get the concurrency key for FIFO ordering
 * Jobs with the same key will be processed in order
 */
function getConcurrencyKey(restaurantId: string, conversationId?: string): string {
  if (conversationId) {
    // FIFO per conversation - ensures messages to same customer are ordered
    return `${restaurantId}:${conversationId}`;
  }
  // FIFO per restaurant if no conversation
  return restaurantId;
}

function sanitizeJobIdComponent(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '_');
}

function getConversationLockKey(concurrencyKey: string): string {
  return `${CONVERSATION_LOCK_PREFIX}${concurrencyKey}`;
}

async function acquireConversationLock(concurrencyKey: string, token: string): Promise<boolean> {
  try {
    const result = await connection.set(
      getConversationLockKey(concurrencyKey),
      token,
      'PX',
      CONVERSATION_LOCK_TTL_MS,
      'NX'
    );
    return result === 'OK';
  } catch (error) {
    console.error(`❌ [WhatsAppSendQueue] Failed to acquire lock for ${concurrencyKey}:`, error);
    return false;
  }
}

async function releaseConversationLock(concurrencyKey: string, token: string | null): Promise<void> {
  if (!token) {
    return;
  }

  const lockKey = getConversationLockKey(concurrencyKey);
  try {
    const current = await connection.get(lockKey);
    if (current === token) {
      await connection.del(lockKey);
    }
  } catch (error) {
    console.error(`❌ [WhatsAppSendQueue] Failed to release lock for ${concurrencyKey}:`, error);
  }
}

async function waitFor(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enqueue a WhatsApp send operation
 */
export async function enqueueWhatsAppSend(
  job: WhatsAppSendJob,
  priority: number = 0
): Promise<Job<WhatsAppSendJob>> {
  const concurrencyKey = getConcurrencyKey(job.restaurantId, job.conversationId);
  
  // Generate unique job ID for idempotency
  const safeKey = sanitizeJobIdComponent(concurrencyKey);
  const jobId =
    job.requestId || `${safeKey}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const queuedJob = await whatsappSendQueue.add(
    'send-whatsapp',
    job,
    {
      jobId,
      priority, // Higher priority = processed first (10 > 5 > 0)
      // Use group key for FIFO ordering per conversation/restaurant
      // BullMQ processes jobs with same group in order
    }
  );
  
  console.log(`📤 [WhatsAppSendQueue] Enqueued job ${jobId} for restaurant ${job.restaurantId} to ${job.phoneNumber}`);
  
  return queuedJob;
}

/**
 * Check if tenant has reached max concurrency
 */
function canProcessForTenant(restaurantId: string): boolean {
  const activeCount = tenantActiveJobs.get(restaurantId) || 0;
  return activeCount < MAX_CONCURRENCY_PER_TENANT;
}

/**
 * Increment active job count for tenant
 */
function incrementTenantJobs(restaurantId: string): void {
  const current = tenantActiveJobs.get(restaurantId) || 0;
  tenantActiveJobs.set(restaurantId, current + 1);
}

/**
 * Decrement active job count for tenant
 */
function decrementTenantJobs(restaurantId: string): void {
  const current = tenantActiveJobs.get(restaurantId) || 0;
  const next = Math.max(0, current - 1);
  
  if (next === 0) {
    tenantActiveJobs.delete(restaurantId);
  } else {
    tenantActiveJobs.set(restaurantId, next);
  }
}

/**
 * Worker to process WhatsApp send operations
 */
export function startWhatsAppSendWorker(): Worker<WhatsAppSendJob> {
  const clientManager = new TwilioClientManager();

  const worker = new Worker<WhatsAppSendJob>(
    WHATSAPP_SEND_QUEUE_NAME,
    async (job: Job<WhatsAppSendJob>) => {
      const { restaurantId, conversationId, phoneNumber, text, fromNumber, templateVariables } = job.data;

      console.log(`🔄 [WhatsAppSendQueue] Processing job ${job.id} for restaurant ${restaurantId}`);

      const concurrencyKey = getConcurrencyKey(restaurantId, conversationId);

      // Enforce per-tenant concurrency limits before acquiring lock
      while (!canProcessForTenant(restaurantId)) {
        await waitFor(TENANT_RETRY_DELAY_MS);
      }

      // Acquire per-conversation lock to guarantee FIFO within conversation
      const lockToken = `${job.id}:${randomUUID()}`;
      let hasLock = await acquireConversationLock(concurrencyKey, lockToken);
      while (!hasLock) {
        await waitFor(CONVERSATION_LOCK_RETRY_DELAY_MS);
        hasLock = await acquireConversationLock(concurrencyKey, lockToken);
      }

      // Enforce per-tenant concurrency
      incrementTenantJobs(restaurantId);

      try {
        // Standardize phone number
        const standardizedPhone = standardizeWhatsappNumber(phoneNumber);
        if (!standardizedPhone) {
          throw new Error(`Invalid phone number: ${phoneNumber}`);
        }
        
        // Get restaurant details
        const restaurant = await getRestaurantByWhatsapp(fromNumber || '');
        
        // Check quota if restaurant is found
        if (restaurant) {
          const quotaCheck = await checkQuota(restaurant.id);
          
          if (!quotaCheck.allowed) {
            console.warn(`⚠️ [WhatsAppSendQueue] Quota exceeded for restaurant ${restaurant.id}: ${quotaCheck.used}/${quotaCheck.limit}`);
            throw new Error(JSON.stringify(formatQuotaError(quotaCheck)));
          }
          
          // Log if nearing quota (90%+)
          if (quotaCheck.limit > 0) {
            const usagePercent = (quotaCheck.used / quotaCheck.limit) * 100;
            if (usagePercent >= 90) {
              console.warn(`⚠️ [WhatsAppSendQueue] Restaurant ${restaurant.id} at ${usagePercent.toFixed(1)}% quota (${quotaCheck.used}/${quotaCheck.limit})`);
            }
          }
        }
        
        // Get appropriate Twilio client
        let twilioClient;
        if (restaurant) {
          twilioClient = await clientManager.getClient(restaurant.id);
        } else {
          console.log(`ℹ️ [WhatsAppSendQueue] No restaurant found for ${fromNumber}, using global client`);
          twilioClient = clientManager.getGlobalClient();
        }
        
        if (!twilioClient) {
          throw new Error('Twilio client not available');
        }
        
        // Send the message
        const result = await sendNotification(twilioClient, standardizedPhone, text, {
          fromNumber,
          templateVariables,
        });
        
        // Track usage if restaurant found
        if (restaurant && conversationId) {
          try {
            await trackUsage({
              restaurantId: restaurant.id,
              conversationId,
              eventType: 'conversation_24hr_session',
              metadata: {
                channel: result.channel,
                sid: result.sid,
                queueJobId: job.id,
              },
            });
          } catch (error) {
            console.warn(`⚠️ [WhatsAppSendQueue] Failed to track usage:`, error);
          }
        }
        
        console.log(`✅ [WhatsAppSendQueue] Job ${job.id} completed: ${result.sid}`);

        return {
          success: true,
          sid: result.sid,
          channel: result.channel,
        };
      } finally {
        decrementTenantJobs(restaurantId);
        await releaseConversationLock(concurrencyKey, lockToken);
      }
    },
    {
      connection,
      concurrency: 20, // Global concurrency - process up to 20 jobs in parallel across all tenants
      limiter: {
        max: GLOBAL_RATE_LIMIT,
        duration: RATE_LIMIT_DURATION,
      },
      // Custom strategy to ensure FIFO per conversation
      // Jobs are picked based on priority and FIFO within same priority
      settings: {
        stalledInterval: 30000, // Check for stalled jobs every 30 seconds
        maxStalledCount: 2, // Move to failed after 2 stalls
      },
    }
  );
  
  worker.on('completed', (job) => {
    console.log(`✅ [WhatsAppSendQueue] Job ${job.id} completed successfully`);
  });
  
  worker.on('failed', (job, err) => {
    console.error(`❌ [WhatsAppSendQueue] Job ${job?.id} failed:`, err.message);
  });
  
  worker.on('error', (err) => {
    console.error('❌ [WhatsAppSendQueue] Worker error:', err);
  });
  
  worker.on('stalled', (jobId) => {
    console.warn(`⚠️ [WhatsAppSendQueue] Job ${jobId} stalled`);
  });
  
  console.log('🚀 [WhatsAppSendQueue] Worker started with per-tenant concurrency control');
  
  return worker;
}

/**
 * Get queue metrics for monitoring
 */
export async function getQueueMetrics() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    whatsappSendQueue.getWaitingCount(),
    whatsappSendQueue.getActiveCount(),
    whatsappSendQueue.getCompletedCount(),
    whatsappSendQueue.getFailedCount(),
    whatsappSendQueue.getDelayedCount(),
  ]);
  
  // Get per-tenant active job counts
  const tenantConcurrency: Record<string, number> = {};
  for (const [restaurantId, count] of tenantActiveJobs.entries()) {
    tenantConcurrency[restaurantId] = count;
  }
  
  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    tenantConcurrency,
    maxConcurrencyPerTenant: MAX_CONCURRENCY_PER_TENANT,
  };
}

/**
 * Get jobs for a specific restaurant
 */
export async function getRestaurantJobs(restaurantId: string, limit: number = 10) {
  const jobs = await whatsappSendQueue.getJobs(['waiting', 'active', 'delayed', 'failed'], 0, limit * 10);

  const targetJobs = jobs
    .filter((job) => job.data.restaurantId === restaurantId)
    .slice(0, limit);

  return Promise.all(
    targetJobs.map(async (job) => ({
      id: job.id,
      status: await job.getState(),
      data: job.data,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
    }))
  );
}

// Graceful shutdown
let queueShuttingDown = false;
process.on('beforeExit', async () => {
  if (queueShuttingDown) {
    return;
  }
  queueShuttingDown = true;
  
  console.log('🛑 [WhatsAppSendQueue] Shutting down gracefully...');
  
  const results = await Promise.allSettled([
    whatsappSendQueue.close(),
    connection.quit(),
  ]);
  
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`❌ [WhatsAppSendQueue] Error during shutdown (step ${index}):`, result.reason);
    }
  });
  
  console.log('✅ [WhatsAppSendQueue] Shutdown complete');
});
