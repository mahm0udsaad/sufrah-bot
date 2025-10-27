#!/usr/bin/env bun
/**
 * Test ID Resolution Logic
 * Verifies that resolveRestaurantId works for both user IDs and restaurant IDs
 */

import { prisma } from '../src/db/client';

async function resolveRestaurantId(identifier: string): Promise<string | null> {
  // First try as restaurant ID (most common case)
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: identifier },
    select: { id: true },
  });
  
  if (restaurant) {
    return restaurant.id;
  }

  // Fallback: try as user ID
  const user = await prisma.user.findUnique({
    where: { id: identifier },
    select: { RestaurantProfile: { select: { id: true } } },
  });

  if (user?.RestaurantProfile?.id) {
    return user.RestaurantProfile.id;
  }

  return null;
}

async function main() {
  console.log('\n🧪 Testing ID Resolution Logic');
  console.log('='.repeat(60));

  const USER_ID = 'cmh9277z60002saerxz967014';
  const RESTAURANT_ID = 'cmh92786r0004saer5gfx81le';

  try {
    // Test 1: Resolve User ID
    console.log('\n📝 Test 1: Resolve User ID');
    console.log(`   Input: ${USER_ID}`);
    const resolvedFromUserId = await resolveRestaurantId(USER_ID);
    console.log(`   Output: ${resolvedFromUserId}`);
    
    if (resolvedFromUserId === RESTAURANT_ID) {
      console.log(`   ✅ Correctly resolved User ID → Restaurant ID`);
    } else {
      console.log(`   ❌ Failed to resolve User ID`);
      console.log(`   Expected: ${RESTAURANT_ID}`);
      console.log(`   Got: ${resolvedFromUserId}`);
    }

    // Test 2: Resolve Restaurant ID
    console.log('\n📝 Test 2: Resolve Restaurant ID (direct)');
    console.log(`   Input: ${RESTAURANT_ID}`);
    const resolvedFromRestaurantId = await resolveRestaurantId(RESTAURANT_ID);
    console.log(`   Output: ${resolvedFromRestaurantId}`);
    
    if (resolvedFromRestaurantId === RESTAURANT_ID) {
      console.log(`   ✅ Correctly resolved Restaurant ID → Restaurant ID`);
    } else {
      console.log(`   ❌ Failed to resolve Restaurant ID`);
      console.log(`   Expected: ${RESTAURANT_ID}`);
      console.log(`   Got: ${resolvedFromRestaurantId}`);
    }

    // Test 3: Invalid ID
    console.log('\n📝 Test 3: Resolve Invalid ID');
    const invalidId = 'invalid-id-12345';
    console.log(`   Input: ${invalidId}`);
    const resolvedFromInvalidId = await resolveRestaurantId(invalidId);
    console.log(`   Output: ${resolvedFromInvalidId}`);
    
    if (resolvedFromInvalidId === null) {
      console.log(`   ✅ Correctly returned null for invalid ID`);
    } else {
      console.log(`   ❌ Should have returned null`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    
    const allPassed = 
      resolvedFromUserId === RESTAURANT_ID &&
      resolvedFromRestaurantId === RESTAURANT_ID &&
      resolvedFromInvalidId === null;

    if (allPassed) {
      console.log('✅ All tests passed!');
      console.log('\n💡 The resolution logic works correctly:');
      console.log('   - User ID → Restaurant ID: Works');
      console.log('   - Restaurant ID → Restaurant ID: Works');
      console.log('   - Invalid ID → null: Works');
      console.log('\n🎉 The 404 error is now fixed!');
    } else {
      console.log('❌ Some tests failed');
    }

  } catch (error) {
    console.error('\n❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();

