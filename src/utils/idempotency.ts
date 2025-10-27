import { redis } from '../redis/client';

/**
 * Idempotency key tracking using Redis
 * Prevents duplicate processing of webhook retries
 */

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours
const IDEMPOTENCY_LOCK_TIMEOUT_MS = Number(process.env.IDEMPOTENCY_LOCK_TIMEOUT_MS || 800);

/**
 * Check if an idempotency key has been processed
 */
export async function isProcessed(key: string): Promise<boolean> {
  try {
    const exists = await redis.exists(`idempotency:${key}`);
    return exists === 1;
  } catch (error) {
    console.error('❌ Idempotency check failed:', error);
    return false;
  }
}

/**
 * Mark an idempotency key as processed
 */
export async function markProcessed(key: string, value: string = '1'): Promise<void> {
  try {
    await redis.setex(`idempotency:${key}`, IDEMPOTENCY_TTL, value);
  } catch (error) {
    console.error('❌ Failed to mark idempotency key:', error);
  }
}

/**
 * Try to acquire an idempotency lock (returns true if acquired, false if already exists)
 */
export async function tryAcquireIdempotencyLock(key: string): Promise<boolean> {
  const redisKey = `idempotency:${key}`;
  const startedAt = Date.now();
  try {
    // Race the SET NX with a timeout to avoid hanging the webhook flow
    const result: string | null = await Promise.race([
      redis.set(redisKey, '1', 'EX', IDEMPOTENCY_TTL, 'NX'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), IDEMPOTENCY_LOCK_TIMEOUT_MS)),
    ] as const);

    const took = Date.now() - startedAt;
    if (result === 'OK') {
      return true;
    }

    if (result === null) {
      console.warn(
        `⚠️ Idempotency lock timed out after ${took}ms for ${redisKey}. Proceeding fail-open.`
      );
      return true; // fail-open on timeout
    }

    // SET returned null → key exists
    return false;
  } catch (error) {
    const took = Date.now() - startedAt;
    console.error(`❌ Failed to acquire idempotency lock (after ${took}ms):`, error);
    return true; // fail-open on error so we don't block inbound processing
  }
}

