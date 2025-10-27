import Redis from 'ioredis';
import { REDIS_URL } from '../config';

// Create Redis client using the properly constructed REDIS_URL
// This ensures we use REDIS_URL when set, falling back to individual components
export const redis = new Redis(REDIS_URL, {
  db: 0,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
  lazyConnect: false, // Auto-connect on instantiation (default behavior)
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

// Remove the manual connect() call - ioredis connects automatically
// redis.connect() ❌ This is causing the error

// Graceful shutdown
let closing = false;
process.on('beforeExit', async () => {
  if (closing) {
    return;
  }
  closing = true;
  try {
    await redis.quit();
  } catch (err) {
    console.error('❌ Error closing Redis connection:', err);
  }
});

export default redis;
// Backward-compatible named export expected by some routes
export const redisClient = redis;