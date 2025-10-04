import { redis } from '../redis/client';

/**
 * Idempotency key tracking using Redis
 * Prevents duplicate processing of webhook retries
 */

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours

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
  try {
    const result = await redis.set(`idempotency:${key}`, '1', 'EX', IDEMPOTENCY_TTL, 'NX');
    return result === 'OK';
  } catch (error) {
    console.error('❌ Failed to acquire idempotency lock:', error);
    return false;
  }
}

