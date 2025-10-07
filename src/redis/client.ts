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
