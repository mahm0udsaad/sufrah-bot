/**
 * Integration tests for quota enforcement and usage tracking
 * Tests limit enforcement, normal flow, and edge cases
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { prisma } from '../src/db/client';
import {
  checkQuota,
  enforceQuota,
  getQuotaStatus,
  isNearingQuota,
  getQuotaUsagePercentage,
  getDaysUntilQuotaReset,
  getQuotaResetDate,
  formatQuotaError,
} from '../src/services/quotaEnforcement';
import {
  trackMessage,
  getCurrentMonthUsage,
  incrementMonthlyUsage,
  resetMonthlyUsage,
} from '../src/services/usageTracking';
import { detectSession } from '../src/services/sessionDetection';

// Test data
const TEST_RESTAURANT_ID = 'test_restaurant_quota_' + Date.now();
const TEST_CUSTOMER_WA = '+966500000001';

describe('Quota Enforcement Integration Tests', () => {
  beforeEach(async () => {
    // Create test restaurant with user
    const testUser = await prisma.user.upsert({
      where: { phone: '+966500000000' },
      update: {},
      create: {
        phone: '+966500000000',
        name: 'Test User',
      },
    });

    await prisma.restaurant.upsert({
      where: { id: TEST_RESTAURANT_ID },
      update: {},
      create: {
        id: TEST_RESTAURANT_ID,
        userId: testUser.id,
        name: 'Test Restaurant',
      },
    });

    // Clean up test data
    await prisma.conversationSession.deleteMany({
      where: { restaurantId: TEST_RESTAURANT_ID },
    });
    await prisma.monthlyUsage.deleteMany({
      where: { restaurantId: TEST_RESTAURANT_ID },
    });
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.conversationSession.deleteMany({
      where: { restaurantId: TEST_RESTAURANT_ID },
    });
    await prisma.monthlyUsage.deleteMany({
      where: { restaurantId: TEST_RESTAURANT_ID },
    });

    // Clean up test restaurant
    await prisma.restaurant.delete({
      where: { id: TEST_RESTAURANT_ID },
    }).catch(() => {});
  });

  describe('Normal Flow - Within Quota', () => {
    test('should allow messages when under quota', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      
      // Track 10 messages (well under 1000 limit)
      for (let i = 0; i < 10; i++) {
        const customerWa = `+96650000000${i}`;
        await trackMessage(TEST_RESTAURANT_ID, customerWa, now);
      }

      const quotaCheck = await checkQuota(TEST_RESTAURANT_ID, 'FREE', now);
      
      expect(quotaCheck.allowed).toBe(true);
      expect(quotaCheck.used).toBe(10);
      expect(quotaCheck.limit).toBe(1000);
      expect(quotaCheck.remaining).toBe(990);
    });

    test('should track sessions correctly across multiple days', async () => {
      // Day 1: 5 new sessions
      const day1 = new Date('2025-01-15T10:00:00Z');
      for (let i = 0; i < 5; i++) {
        await trackMessage(TEST_RESTAURANT_ID, `+96650000000${i}`, day1);
      }

      // Day 2 (same month): 3 more new sessions
      const day2 = new Date('2025-01-16T10:00:00Z');
      for (let i = 5; i < 8; i++) {
        await trackMessage(TEST_RESTAURANT_ID, `+96650000000${i}`, day2);
      }

      const usage = await getCurrentMonthUsage(TEST_RESTAURANT_ID, day2);
      
      expect(usage.conversationCount).toBe(8);
    });

    test('should not count repeat messages within 24h as new sessions', async () => {
      const startTime = new Date('2025-01-15T10:00:00Z');
      
      // Send 10 messages from same customer within 24h
      for (let i = 0; i < 10; i++) {
        const messageTime = new Date(startTime.getTime() + i * 60 * 60 * 1000); // Every hour
        await trackMessage(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA, messageTime);
      }

      const usage = await getCurrentMonthUsage(TEST_RESTAURANT_ID, startTime);
      
      // Should only count as 1 session
      expect(usage.conversationCount).toBe(1);
    });
  });

  describe('Limit Hit Scenarios', () => {
    test('should block when quota is exceeded', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      // Manually set usage to limit
      await incrementMonthlyUsage(TEST_RESTAURANT_ID, month, year, now);
      await prisma.monthlyUsage.update({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID,
            month,
            year,
          },
        },
        data: {
          conversationCount: 1000, // At limit
        },
      });

      const quotaCheck = await checkQuota(TEST_RESTAURANT_ID, 'FREE', now);
      
      expect(quotaCheck.allowed).toBe(false);
      expect(quotaCheck.used).toBe(1000);
      expect(quotaCheck.limit).toBe(1000);
      expect(quotaCheck.remaining).toBe(0);
      expect(quotaCheck.errorCode).toBe('QUOTA_EXCEEDED');
      expect(quotaCheck.errorMessage).toContain('Monthly conversation limit');
    });

    test('should throw error when enforcing exceeded quota', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      // Set usage to exceed limit
      await incrementMonthlyUsage(TEST_RESTAURANT_ID, month, year, now);
      await prisma.monthlyUsage.update({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID,
            month,
            year,
          },
        },
        data: {
          conversationCount: 1001,
        },
      });

      expect(async () => {
        await enforceQuota(TEST_RESTAURANT_ID, 'FREE', now);
      }).toThrow();
    });

    test('should allow after quota reset in new month', async () => {
      // January: reach limit
      const january = new Date('2025-01-31T23:59:59Z');
      await incrementMonthlyUsage(TEST_RESTAURANT_ID, 1, 2025, january);
      await prisma.monthlyUsage.update({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID,
            month: 1,
            year: 2025,
          },
        },
        data: {
          conversationCount: 1000,
        },
      });

      const januaryCheck = await checkQuota(TEST_RESTAURANT_ID, 'FREE', january);
      expect(januaryCheck.allowed).toBe(false);

      // February: quota reset
      const february = new Date('2025-02-01T00:00:00Z');
      const februaryCheck = await checkQuota(TEST_RESTAURANT_ID, 'FREE', february);
      
      expect(februaryCheck.allowed).toBe(true);
      expect(februaryCheck.used).toBe(0);
      expect(februaryCheck.remaining).toBe(1000);
    });
  });

  describe('Quota Warning Scenarios', () => {
    test('should detect when nearing quota (90%)', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      // Set usage to 90% of limit
      await incrementMonthlyUsage(TEST_RESTAURANT_ID, month, year, now);
      await prisma.monthlyUsage.update({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID,
            month,
            year,
          },
        },
        data: {
          conversationCount: 900, // 90% of 1000
        },
      });

      const isNearing = await isNearingQuota(TEST_RESTAURANT_ID, 0.9, 'FREE', now);
      
      expect(isNearing).toBe(true);
    });

    test('should calculate correct usage percentage', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      // Set usage to 75% of limit
      await incrementMonthlyUsage(TEST_RESTAURANT_ID, month, year, now);
      await prisma.monthlyUsage.update({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID,
            month,
            year,
          },
        },
        data: {
          conversationCount: 750,
        },
      });

      const percentage = await getQuotaUsagePercentage(TEST_RESTAURANT_ID, 'FREE', now);
      
      expect(percentage).toBe(75);
    });

    test('should not warn when below threshold', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      // Set usage to 50% of limit
      await incrementMonthlyUsage(TEST_RESTAURANT_ID, month, year, now);
      await prisma.monthlyUsage.update({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID,
            month,
            year,
          },
        },
        data: {
          conversationCount: 500,
        },
      });

      const isNearing = await isNearingQuota(TEST_RESTAURANT_ID, 0.9, 'FREE', now);
      
      expect(isNearing).toBe(false);
    });
  });

  describe('Different Plan Tiers', () => {
    test('should enforce BASIC plan limit (5000)', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      await incrementMonthlyUsage(TEST_RESTAURANT_ID, month, year, now);
      await prisma.monthlyUsage.update({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID,
            month,
            year,
          },
        },
        data: {
          conversationCount: 5000,
        },
      });

      const quotaCheck = await checkQuota(TEST_RESTAURANT_ID, 'BASIC', now);
      
      expect(quotaCheck.allowed).toBe(false);
      expect(quotaCheck.limit).toBe(5000);
    });

    test('should allow unlimited for ENTERPRISE plan', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      // Set very high usage
      await incrementMonthlyUsage(TEST_RESTAURANT_ID, month, year, now);
      await prisma.monthlyUsage.update({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID,
            month,
            year,
          },
        },
        data: {
          conversationCount: 100000,
        },
      });

      const quotaCheck = await checkQuota(TEST_RESTAURANT_ID, 'ENTERPRISE', now);
      
      expect(quotaCheck.allowed).toBe(true);
      expect(quotaCheck.limit).toBe(-1); // unlimited
    });
  });

  describe('Utility Functions', () => {
    test('should calculate correct days until quota reset', () => {
      const date = new Date('2025-01-15T10:00:00Z');
      const daysRemaining = getDaysUntilQuotaReset(date);
      
      // Should be 17 days (31 days in January - 14 complete days)
      expect(daysRemaining).toBe(17);
    });

    test('should format quota error correctly', () => {
      const quotaCheck = {
        allowed: false,
        remaining: 0,
        used: 1000,
        limit: 1000,
        planName: 'Free Plan',
        errorCode: 'QUOTA_EXCEEDED',
        errorMessage: 'Monthly conversation limit of 1000 reached',
      };

      const formatted = formatQuotaError(quotaCheck);
      
      expect(formatted.error).toContain('Monthly conversation limit');
      expect(formatted.code).toBe('QUOTA_EXCEEDED');
      expect(formatted.details.used).toBe(1000);
      expect(formatted.details.limit).toBe(1000);
      expect(formatted.details.remaining).toBe(0);
      expect(formatted.details.daysUntilReset).toBeGreaterThan(0);
      expect(formatted.details.resetDate).toBeDefined();
    });

    test('should get quota reset date correctly', () => {
      const date = new Date('2025-01-15T10:00:00Z');
      const resetDate = getQuotaResetDate(date);
      
      // Should be February 1, 2025
      expect(resetDate).toContain('2025-02-01');
    });
  });

  describe('Edge Cases', () => {
    test('should handle month boundary correctly', async () => {
      // Last day of January
      const endOfJanuary = new Date('2025-01-31T23:59:59Z');
      await trackMessage(TEST_RESTAURANT_ID, '+966500000001', endOfJanuary);

      // First day of February
      const startOfFebruary = new Date('2025-02-01T00:00:00Z');
      await trackMessage(TEST_RESTAURANT_ID, '+966500000002', startOfFebruary);

      // Check January usage
      const januaryUsage = await getCurrentMonthUsage(TEST_RESTAURANT_ID, endOfJanuary);
      expect(januaryUsage.conversationCount).toBe(1);

      // Check February usage
      const februaryUsage = await getCurrentMonthUsage(TEST_RESTAURANT_ID, startOfFebruary);
      expect(februaryUsage.conversationCount).toBe(1);
    });

    test('should handle year boundary correctly', async () => {
      // Last day of December 2024
      const endOf2024 = new Date('2024-12-31T23:59:59Z');
      await trackMessage(TEST_RESTAURANT_ID, '+966500000001', endOf2024);

      // First day of January 2025
      const startOf2025 = new Date('2025-01-01T00:00:00Z');
      await trackMessage(TEST_RESTAURANT_ID, '+966500000002', startOf2025);

      // Check December 2024 usage
      const decemberUsage = await getCurrentMonthUsage(TEST_RESTAURANT_ID, endOf2024);
      expect(decemberUsage.conversationCount).toBe(1);
      expect(decemberUsage.month).toBe(12);
      expect(decemberUsage.year).toBe(2024);

      // Check January 2025 usage
      const januaryUsage = await getCurrentMonthUsage(TEST_RESTAURANT_ID, startOf2025);
      expect(januaryUsage.conversationCount).toBe(1);
      expect(januaryUsage.month).toBe(1);
      expect(januaryUsage.year).toBe(2025);
    });

    test('should handle concurrent session creation', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      
      // Simulate concurrent messages from same customer
      const results = await Promise.all([
        trackMessage(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA, now),
        trackMessage(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA, now),
        trackMessage(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA, now),
      ]);

      // Should only create 1 session despite concurrent requests
      const usage = await getCurrentMonthUsage(TEST_RESTAURANT_ID, now);
      expect(usage.conversationCount).toBe(1);
      
      // All results should reference the same session
      const sessionIds = results.map(r => r.sessionInfo.sessionId);
      const uniqueSessionIds = new Set(sessionIds);
      expect(uniqueSessionIds.size).toBe(1);
    });

    test('should handle exactly at limit edge case', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      // Set usage to exactly 999 (one below limit)
      await incrementMonthlyUsage(TEST_RESTAURANT_ID, month, year, now);
      await prisma.monthlyUsage.update({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID,
            month,
            year,
          },
        },
        data: {
          conversationCount: 999,
        },
      });

      // Should be allowed
      const beforeCheck = await checkQuota(TEST_RESTAURANT_ID, 'FREE', now);
      expect(beforeCheck.allowed).toBe(true);
      expect(beforeCheck.remaining).toBe(1);

      // Increment to exactly 1000
      await incrementMonthlyUsage(TEST_RESTAURANT_ID, month, year, now);

      // Should now be blocked
      const afterCheck = await checkQuota(TEST_RESTAURANT_ID, 'FREE', now);
      expect(afterCheck.allowed).toBe(false);
      expect(afterCheck.remaining).toBe(0);
    });
  });
});

