/**
 * Welcome Bootstrap Worker
 * Pre-fetches menu/branch data and warms template caches when welcome template fires
 * 
 * Run this in a separate process:
 * bun run src/workers/welcomeBootstrapWorker.ts
 */

import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_URL, QUEUE_RETRY_ATTEMPTS, QUEUE_BACKOFF_DELAY } from '../config';
import { getMenuCategories, getMerchantBranches } from '../workflows/menuData';
import { seedCacheFromKey } from '../workflows/cache';
import type { WelcomeBootstrapJob } from '../redis/queue';

const BOOTSTRAP_QUEUE_NAME = 'welcome-bootstrap';

// Create Redis connection for BullMQ
const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Create welcome bootstrap queue
export const welcomeBootstrapQueue = new Queue<WelcomeBootstrapJob>(BOOTSTRAP_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: QUEUE_RETRY_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: QUEUE_BACKOFF_DELAY,
    },
    removeOnComplete: {
      age: 86400, // Keep completed jobs for 24 hours
      count: 1000,
    },
    removeOnFail: false,
  },
});

/**
 * Enqueue a welcome bootstrap job
 */
export async function enqueueWelcomeBootstrap(
  job: WelcomeBootstrapJob,
  priority: number = 10 // Lower priority than outbound messages
): Promise<void> {
  await welcomeBootstrapQueue.add('bootstrap', job, { priority });
  console.log(`📦 Enqueued welcome bootstrap for merchant ${job.merchantId}, customer ${job.customerWa}`);
}

/**
 * Pre-fetch and cache menu categories for a merchant
 */
async function warmMenuCategories(merchantId: string): Promise<number> {
  try {
    const categories = await getMenuCategories(merchantId);
    console.log(`📚 Pre-fetched ${categories.length} categories for merchant ${merchantId}`);
    return categories.length;
  } catch (error) {
    console.error(`❌ Failed to pre-fetch categories for merchant ${merchantId}:`, error);
    throw error;
  }
}

/**
 * Pre-fetch and cache branches for a merchant
 */
async function warmBranches(merchantId: string): Promise<number> {
  try {
    const branches = await getMerchantBranches(merchantId);
    console.log(`🏪 Pre-fetched ${branches.length} branches for merchant ${merchantId}`);
    return branches.length;
  } catch (error) {
    console.error(`❌ Failed to pre-fetch branches for merchant ${merchantId}:`, error);
    throw error;
  }
}

/**
 * Warm template SID caches
 */
async function warmTemplateSids(): Promise<void> {
  try {
    // Seed common template caches
    const templates = [
      { key: 'welcome', sid: process.env.CONTENT_SID_WELCOME },
      { key: 'order_type', sid: process.env.CONTENT_SID_ORDER_TYPE },
      { key: 'categories', sid: process.env.CONTENT_SID_CATEGORIES },
      { key: 'post_item_choice', sid: process.env.CONTENT_SID_POST_ITEM_CHOICE },
      { key: 'location_request', sid: process.env.CONTENT_SID_LOCATION_REQUEST },
      { key: 'quantity_prompt', sid: process.env.CONTENT_SID_QUANTITY },
      { key: 'cart_options', sid: process.env.CONTENT_SID_CART_OPTIONS },
      { key: 'payment_options', sid: process.env.CONTENT_SID_PAYMENT_OPTIONS },
      { key: 'branch_list', sid: process.env.CONTENT_SID_BRANCH_LIST },
      { key: 'rating_list', sid: process.env.CONTENT_SID_RATING_LIST },
    ];

    for (const { key, sid } of templates) {
      if (sid) {
        seedCacheFromKey(key, sid);
      }
    }

    console.log(`🔥 Warmed ${templates.filter(t => t.sid).length} template SIDs`);
  } catch (error) {
    console.error('❌ Failed to warm template SIDs:', error);
    // Don't throw - this is not critical
  }
}

/**
 * Worker to process welcome bootstrap jobs
 */
export function startWelcomeBootstrapWorker(): Worker<WelcomeBootstrapJob> {
  const worker = new Worker<WelcomeBootstrapJob>(
    BOOTSTRAP_QUEUE_NAME,
    async (job: Job<WelcomeBootstrapJob>) => {
      const { restaurantId, merchantId, customerWa, profileName } = job.data;

      console.log(`🔄 Processing welcome bootstrap job ${job.id} for merchant ${merchantId}`);

      const startTime = Date.now();

      try {
        // Pre-fetch menu data and branches in parallel
        const [categoriesCount, branchesCount] = await Promise.all([
          warmMenuCategories(merchantId),
          warmBranches(merchantId),
        ]);

        // Warm template SIDs
        await warmTemplateSids();

        const duration = Date.now() - startTime;

        console.log(
          `✅ Welcome bootstrap completed for ${customerWa} in ${duration}ms ` +
          `(${categoriesCount} categories, ${branchesCount} branches)`
        );

        return {
          success: true,
          duration,
          categoriesCount,
          branchesCount,
        };
      } catch (error: any) {
        const duration = Date.now() - startTime;
        console.error(`❌ Welcome bootstrap failed for ${customerWa} after ${duration}ms:`, error);
        throw error;
      }
    },
    {
      connection,
      concurrency: 5, // Process up to 5 bootstrap jobs in parallel
      limiter: {
        max: 20, // Max 20 jobs per duration
        duration: 60000, // 60 seconds
      },
    }
  );

  worker.on('completed', (job, result) => {
    console.log(
      `✅ Bootstrap job ${job.id} completed in ${result.duration}ms ` +
      `(${result.categoriesCount} categories, ${result.branchesCount} branches)`
    );
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Bootstrap job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('❌ Bootstrap worker error:', err);
  });

  console.log('🚀 Welcome bootstrap worker started');

  return worker;
}

// Graceful shutdown
let workerShuttingDown = false;
process.on('beforeExit', async () => {
  if (workerShuttingDown) {
    return;
  }
  workerShuttingDown = true;

  const results = await Promise.allSettled([
    welcomeBootstrapQueue.close(),
    connection.quit(),
  ]);

  results.forEach((result) => {
    if (result.status === 'rejected') {
      console.error('❌ Error closing bootstrap queue Redis connection:', result.reason);
    }
  });
});

// If run directly, start the worker
if (import.meta.main) {
  console.log('🚀 Starting welcome bootstrap worker...');
  
  const worker = startWelcomeBootstrapWorker();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('⏹️  SIGTERM received, shutting down gracefully...');
    await worker.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('⏹️  SIGINT received, shutting down gracefully...');
    await worker.close();
    process.exit(0);
  });

  console.log('✅ Welcome bootstrap worker is running');
  console.log('📦 Waiting for jobs...');
}

