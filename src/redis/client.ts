import Redis from 'ioredis';
import { REDIS_URL, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } from '../config';

// Create Redis client for general use
const useTLS = REDIS_URL.startsWith('rediss://');

export const redis = new Redis({
  host: REDIS_HOST,
  port: Number(REDIS_PORT),
  password: REDIS_PASSWORD || undefined,
  ...(useTLS ? { tls: {} } : {}),
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