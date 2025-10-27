import { redis } from '../redis/client';

/**
 * Token bucket rate limiter using Redis
 * Enforces per-restaurant and per-customer rate limits
 */

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check rate limit using token bucket algorithm
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowKey = `ratelimit:${key}:${Math.floor(now / windowMs)}`;
  const timeoutMs = Number(process.env.RATE_LIMIT_TIMEOUT_MS || 600);

  try {
    // Race Redis INCR with a timeout to avoid blocking inbound flow
    const countOrNull: number | null = await Promise.race([
      redis.incr(windowKey),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ] as const);

    // Fail open on timeout
    if (countOrNull === null) {
      console.warn(`⚠️ Rate limit check timeout after ${timeoutMs}ms for ${windowKey}. Allowing request.`);
      return { allowed: true, remaining: maxRequests, resetAt: now + windowMs };
    }

    const count = countOrNull;

    // Set expiry on first request in window
    if (count === 1) {
      await redis.pexpire(windowKey, windowMs);
    }

    const allowed = count <= maxRequests;
    const remaining = Math.max(0, maxRequests - count);
    const resetAt = Math.floor(now / windowMs) * windowMs + windowMs;

    return { allowed, remaining, resetAt };
  } catch (error) {
    console.error('❌ Rate limit check failed:', error);
    // Fail open - allow request if Redis is down
    return { allowed: true, remaining: maxRequests, resetAt: now + windowMs };
  }
}

/**
 * Check rate limit for a restaurant
 */
export async function checkRestaurantRateLimit(
  restaurantId: string,
  maxRequests: number = 60,
  windowMs: number = 60000
): Promise<RateLimitResult> {
  return checkRateLimit(`restaurant:${restaurantId}`, maxRequests, windowMs);
}

/**
 * Check rate limit for a customer
 */
export async function checkCustomerRateLimit(
  restaurantId: string,
  customerPhone: string,
  maxRequests: number = 20,
  windowMs: number = 60000
): Promise<RateLimitResult> {
  return checkRateLimit(`customer:${restaurantId}:${customerPhone}`, maxRequests, windowMs);
}

/**
 * Check global rate limit (for webhook endpoint)
 */
export async function checkGlobalRateLimit(
  maxRequests: number = 200,
  windowMs: number = 60000
): Promise<RateLimitResult> {
  return checkRateLimit('global', maxRequests, windowMs);
}

