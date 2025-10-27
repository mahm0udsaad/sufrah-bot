#!/usr/bin/env bun
/**
 * Debug Usage API - Diagnose 404 errors and missing usage records
 */

import { prisma } from '../src/db/client';
import { checkQuota } from '../src/services/quotaEnforcement';
import { getCurrentMonthUsage } from '../src/services/usageTracking';

async function debugUsageApi(identifier: string) {
  console.log('\n🔍 Debugging Usage API for:', identifier);
  console.log('='.repeat(60));

  try {
    // Try as user ID first
    const user = await prisma.user.findUnique({
      where: { id: identifier },
      include: {
        RestaurantProfile: {
          include: {
            bots: true,
            monthlyUsage: true,
          },
        },
      },
    });

    if (user) {
      console.log('\n✅ Found USER:');
      console.log(`   ID: ${user.id}`);
      console.log(`   Name: ${user.name}`);
      console.log(`   Phone: ${user.phone}`);
      
      if (user.RestaurantProfile) {
        const restaurant = user.RestaurantProfile;
        console.log('\n✅ Found RESTAURANT:');
        console.log(`   ID: ${restaurant.id} ⚠️  THIS IS THE CORRECT ID TO USE`);
        console.log(`   Name: ${restaurant.name}`);
        console.log(`   Status: ${restaurant.status}`);
        console.log(`   Active: ${restaurant.isActive}`);
        
        // Check bots
        if (restaurant.bots && restaurant.bots.length > 0) {
          console.log('\n📱 Bots:');
          restaurant.bots.forEach((bot) => {
            console.log(`   - ${bot.name} (${bot.whatsappNumber})`);
            console.log(`     Status: ${bot.status}, Active: ${bot.isActive}`);
          });
        }

        // Check usage records
        console.log('\n📊 Monthly Usage Records:');
        if (restaurant.monthlyUsage && restaurant.monthlyUsage.length > 0) {
          restaurant.monthlyUsage.forEach((usage) => {
            console.log(`   - ${usage.month}/${usage.year}: ${usage.conversationCount} conversations`);
          });
        } else {
          console.log('   ⚠️  No usage records found - will be created on first conversation');
        }

        // Check quota
        console.log('\n💳 Quota Status:');
        const quota = await checkQuota(restaurant.id);
        console.log(`   Plan: ${quota.planName}`);
        console.log(`   Used: ${quota.used} / ${quota.limit === -1 ? 'Unlimited' : quota.limit}`);
        console.log(`   Remaining: ${quota.remaining === -1 ? 'Unlimited' : quota.remaining}`);
        console.log(`   Allowed: ${quota.allowed ? '✅' : '❌'}`);
        if (quota.effectiveLimit !== quota.limit) {
          console.log(`   Effective Limit: ${quota.effectiveLimit} (adjusted by ${quota.adjustedBy})`);
        }

        // Check current month usage (this should create record if missing)
        console.log('\n📅 Current Month:');
        const currentUsage = await getCurrentMonthUsage(restaurant.id);
        console.log(`   Month: ${currentUsage.month}/${currentUsage.year}`);
        console.log(`   Conversations: ${currentUsage.conversationCount}`);

        // Test API URLs
        console.log('\n🔗 Correct API Usage:');
        console.log(`   For PAT: X-Restaurant-Id: ${restaurant.id}`);
        console.log(`   GET /api/usage (with X-Restaurant-Id header)`);
        console.log(`   GET /api/usage/details (with X-Restaurant-Id header)`);
        console.log('\n   For Admin API Key:');
        console.log(`   GET /api/usage/${restaurant.id}`);
        console.log(`   GET /api/usage/${restaurant.id}/details`);

        return {
          userId: user.id,
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
        };
      } else {
        console.log('\n❌ No restaurant profile found for this user');
      }
    }

    // Try as restaurant ID
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: identifier },
      include: {
        user: true,
        bots: true,
        monthlyUsage: true,
      },
    });

    if (restaurant) {
      console.log('\n✅ Found RESTAURANT directly:');
      console.log(`   ID: ${restaurant.id}`);
      console.log(`   Name: ${restaurant.name}`);
      console.log(`   User ID: ${restaurant.userId}`);
      console.log(`   Status: ${restaurant.status}`);
      console.log(`   Active: ${restaurant.isActive}`);

      // Check bots
      if (restaurant.bots && restaurant.bots.length > 0) {
        console.log('\n📱 Bots:');
        restaurant.bots.forEach((bot) => {
          console.log(`   - ${bot.name} (${bot.whatsappNumber})`);
          console.log(`     Status: ${bot.status}, Active: ${bot.isActive}`);
        });
      }

      // Check quota
      console.log('\n💳 Quota Status:');
      const quota = await checkQuota(restaurant.id);
      console.log(`   Plan: ${quota.planName}`);
      console.log(`   Used: ${quota.used} / ${quota.limit === -1 ? 'Unlimited' : quota.limit}`);
      console.log(`   Remaining: ${quota.remaining === -1 ? 'Unlimited' : quota.remaining}`);
      console.log(`   Allowed: ${quota.allowed ? '✅' : '❌'}`);

      return {
        userId: restaurant.userId,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
      };
    }

    console.log('\n❌ No user or restaurant found with ID:', identifier);
    console.log('\n💡 Common issues:');
    console.log('   1. Using User ID instead of Restaurant ID');
    console.log('   2. Restaurant not created yet');
    console.log('   3. Typo in the ID');

  } catch (error) {
    console.error('\n❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run with provided ID or default
const identifier = process.argv[2] || 'cmh9277z60002saerxz967014';
debugUsageApi(identifier);

