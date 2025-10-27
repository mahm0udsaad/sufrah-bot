#!/usr/bin/env bun
/**
 * Test Usage API with both User ID and Restaurant ID
 * Verifies the auto-resolution fix works correctly
 */

import { DASHBOARD_PAT } from '../src/config';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

// Test data from the user's issue
const USER_ID = 'cmh9277z60002saerxz967014';
const RESTAURANT_ID = 'cmh92786r0004saer5gfx81le';

async function testUsageAPI(identifier: string, label: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 Testing with ${label}: ${identifier}`);
  console.log('='.repeat(60));

  try {
    // Test 1: GET /api/usage
    console.log('\n📋 Test 1: GET /api/usage');
    const usageResponse = await fetch(`${BASE_URL}/api/usage`, {
      headers: {
        'Authorization': `Bearer ${DASHBOARD_PAT}`,
        'X-Restaurant-Id': identifier,
      },
    });

    console.log(`   Status: ${usageResponse.status} ${usageResponse.statusText}`);
    
    if (usageResponse.ok) {
      const data = await usageResponse.json();
      console.log(`   ✅ Success!`);
      console.log(`   Restaurant: ${data.restaurantName}`);
      console.log(`   Conversations: ${data.conversationsThisMonth}`);
      console.log(`   Quota: ${data.allowance?.monthlyRemaining}/${data.allowance?.monthlyLimit}`);
    } else {
      const error = await usageResponse.text();
      console.log(`   ❌ Failed: ${error}`);
      return false;
    }

    // Test 2: GET /api/usage/details
    console.log('\n📊 Test 2: GET /api/usage/details');
    const detailsResponse = await fetch(`${BASE_URL}/api/usage/details`, {
      headers: {
        'Authorization': `Bearer ${DASHBOARD_PAT}`,
        'X-Restaurant-Id': identifier,
      },
    });

    console.log(`   Status: ${detailsResponse.status} ${detailsResponse.statusText}`);
    
    if (detailsResponse.ok) {
      const data = await detailsResponse.json();
      console.log(`   ✅ Success!`);
      console.log(`   Restaurant: ${data.restaurantName}`);
      console.log(`   Active Sessions: ${data.activeSessionsCount}`);
      console.log(`   Daily Breakdown: ${data.dailyBreakdown?.length || 0} days`);
      console.log(`   Recent Sessions: ${data.recentSessions?.length || 0} sessions`);
    } else {
      const error = await detailsResponse.text();
      console.log(`   ❌ Failed: ${error}`);
      return false;
    }

    console.log(`\n✅ All tests passed for ${label}!`);
    return true;

  } catch (error) {
    console.error(`\n❌ Error testing with ${label}:`, error);
    return false;
  }
}

async function main() {
  console.log('\n🚀 Testing Usage API Auto-Resolution Fix');
  console.log(`API URL: ${BASE_URL}`);
  
  if (!DASHBOARD_PAT) {
    console.error('\n❌ DASHBOARD_PAT environment variable not set');
    process.exit(1);
  }

  // Test with User ID (the problematic case)
  const userIdResult = await testUsageAPI(USER_ID, 'User ID');

  // Test with Restaurant ID (should still work)
  const restaurantIdResult = await testUsageAPI(RESTAURANT_ID, 'Restaurant ID');

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`User ID (${USER_ID}): ${userIdResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Restaurant ID (${RESTAURANT_ID}): ${restaurantIdResult ? '✅ PASS' : '❌ FAIL'}`);

  if (userIdResult && restaurantIdResult) {
    console.log('\n🎉 All tests passed! The fix works correctly.');
    console.log('\n💡 The API now accepts BOTH User ID and Restaurant ID in X-Restaurant-Id header.');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. Check the server logs for details.');
    process.exit(1);
  }
}

main();

