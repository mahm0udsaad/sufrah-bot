import Redis from 'ioredis';
import { REDIS_URL } from '../config';

// Create Redis client for general use
const useTLS = REDIS_URL.startsWith('rediss://');

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true,
  tls: useTLS ? {} : undefined,
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

// Connect immediately
redis.connect().catch((err) => {
  console.error('❌ Failed to connect to Redis:', err);
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await redis.quit();
});

export default redis;

