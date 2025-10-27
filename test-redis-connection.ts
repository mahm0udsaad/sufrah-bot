#!/usr/bin/env bun

/**
 * Test Redis connection
 */

import { redis } from './src/redis/client';

console.log('🔌 Testing Redis connection...\n');

async function testRedis() {
  try {
    console.log('⏱️  Attempting to connect to Redis...');
    
    // Set a timeout
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Redis connection timed out')), 5000)
    );
    
    const pingPromise = redis.ping();
    
    const result = await Promise.race([pingPromise, timeout]);
    
    console.log('✅ Redis connection successful!');
    console.log('   PING response:', result);
    
    // Test set and get
    console.log('\n⏱️  Testing Redis SET/GET...');
    await redis.set('test:key', 'test:value', 'EX', 10);
    const value = await redis.get('test:key');
    console.log(`✅ SET/GET works! Value: ${value}`);
    
    return true;
  } catch (error: any) {
    console.error('❌ Redis connection failed!');
    console.error('   Error:', error.message);
    
    if (error.message.includes('timeout')) {
      console.error('\n🔍 Redis is timing out. Possible causes:');
      console.error('   1. Redis server is down or unreachable');
      console.error('   2. Firewall blocking connection');
      console.error('   3. Incorrect REDIS_URL');
      console.error('   4. Redis server requires authentication');
    }
    
    return false;
  } finally {
    await redis.quit();
  }
}

testRedis().then((success) => {
  process.exit(success ? 0 : 1);
});

