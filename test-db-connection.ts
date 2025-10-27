#!/usr/bin/env bun

/**
 * Test database connection
 */

import { prisma } from './src/db/client';

console.log('🔌 Testing database connection...\n');

async function testDatabase() {
  try {
    console.log('⏱️  Attempting to connect to database...');
    
    // Set a timeout
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database query timed out')), 5000)
    );
    
    const query = prisma.$queryRaw`SELECT 1 as test`;
    
    const result = await Promise.race([query, timeout]);
    
    console.log('✅ Database connection successful!');
    console.log('   Result:', result);
    
    // Test a simple count query
    console.log('\n⏱️  Testing RestaurantBot table...');
    const count = await prisma.restaurantBot.count();
    console.log(`✅ Found ${count} restaurant bots in database`);
    
    return true;
  } catch (error: any) {
    console.error('❌ Database connection failed!');
    console.error('   Error:', error.message);
    
    if (error.message.includes('timeout')) {
      console.error('\n🔍 Database is timing out. Possible causes:');
      console.error('   1. Database server is down or unreachable');
      console.error('   2. Firewall blocking connection');
      console.error('   3. Incorrect DATABASE_URL');
      console.error('   4. Database is under heavy load');
    }
    
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

testDatabase().then((success) => {
  process.exit(success ? 0 : 1);
});

