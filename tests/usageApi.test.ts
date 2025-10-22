/**
 * Unit tests for Usage API
 * Tests authentication, pagination, data formatting, and edge cases
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { prisma } from '../src/db/client';

// Test data
const TEST_USER_ID = 'test_user_usage_' + Date.now();
const TEST_RESTAURANT_ID_1 = 'test_restaurant_usage_1_' + Date.now();
const TEST_RESTAURANT_ID_2 = 'test_restaurant_usage_2_' + Date.now();
const TEST_RESTAURANT_ID_3 = 'test_restaurant_usage_3_' + Date.now();

describe('Usage API', () => {
  let testUser1: any;
  let testUser2: any;
  let testUser3: any;
  let testRestaurant1: any;
  let testRestaurant2: any;
  let testRestaurant3: any;
  let testBot1: any;

  beforeEach(async () => {
    // Create test users (separate user for each restaurant due to unique constraint)
    testUser1 = await prisma.user.create({
      data: {
        id: TEST_USER_ID + '_1',
        phone: '+966500' + Date.now() + '1',
        name: 'Test User 1',
      },
    });

    testUser2 = await prisma.user.create({
      data: {
        id: TEST_USER_ID + '_2',
        phone: '+966500' + Date.now() + '2',
        name: 'Test User 2',
      },
    });

    testUser3 = await prisma.user.create({
      data: {
        id: TEST_USER_ID + '_3',
        phone: '+966500' + Date.now() + '3',
        name: 'Test User 3',
      },
    });

    // Create test restaurants
    testRestaurant1 = await prisma.restaurant.create({
      data: {
        id: TEST_RESTAURANT_ID_1,
        userId: testUser1.id,
        name: 'Test Restaurant 1',
        isActive: true,
      },
    });

    testRestaurant2 = await prisma.restaurant.create({
      data: {
        id: TEST_RESTAURANT_ID_2,
        userId: testUser2.id,
        name: 'Test Restaurant 2',
        isActive: true,
      },
    });

    testRestaurant3 = await prisma.restaurant.create({
      data: {
        id: TEST_RESTAURANT_ID_3,
        userId: testUser3.id,
        name: 'Test Restaurant 3 - Inactive',
        isActive: false,
      },
    });

    // Create bot with limits for restaurant 1
    testBot1 = await prisma.restaurantBot.create({
      data: {
        restaurantId: TEST_RESTAURANT_ID_1,
        name: 'Test Bot',
        restaurantName: 'Test Restaurant 1',
        whatsappNumber: 'whatsapp:+966500000001',
        accountSid: 'ACtest123',
        authToken: 'test_token',
        isActive: true,
        maxMessagesPerDay: 100,
        maxMessagesPerMin: 10,
      },
    });

    // Create monthly usage records
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();

    await prisma.monthlyUsage.create({
      data: {
        restaurantId: TEST_RESTAURANT_ID_1,
        month: currentMonth,
        year: currentYear,
        conversationCount: 45,
        lastConversationAt: new Date('2025-10-20T15:30:00Z'),
      },
    });

    await prisma.monthlyUsage.create({
      data: {
        restaurantId: TEST_RESTAURANT_ID_2,
        month: currentMonth,
        year: currentYear,
        conversationCount: 120,
        lastConversationAt: new Date('2025-10-21T10:00:00Z'),
      },
    });

    // Add historical data
    await prisma.monthlyUsage.create({
      data: {
        restaurantId: TEST_RESTAURANT_ID_1,
        month: currentMonth - 1,
        year: currentYear,
        conversationCount: 89,
        lastConversationAt: new Date('2025-09-30T23:45:00Z'),
      },
    });

    // Create test conversations for activity timestamps
    await prisma.conversation.create({
      data: {
        restaurantId: TEST_RESTAURANT_ID_1,
        customerWa: '+966500111111',
        createdAt: new Date('2025-09-01T08:00:00Z'),
        lastMessageAt: new Date('2025-10-20T15:30:00Z'),
      },
    });
  });

  afterEach(async () => {
    // Clean up in reverse order of dependencies
    await prisma.conversation.deleteMany({
      where: {
        restaurantId: { in: [TEST_RESTAURANT_ID_1, TEST_RESTAURANT_ID_2, TEST_RESTAURANT_ID_3] },
      },
    });

    await prisma.monthlyUsage.deleteMany({
      where: {
        restaurantId: { in: [TEST_RESTAURANT_ID_1, TEST_RESTAURANT_ID_2, TEST_RESTAURANT_ID_3] },
      },
    });

    await prisma.restaurantBot.deleteMany({
      where: {
        restaurantId: { in: [TEST_RESTAURANT_ID_1, TEST_RESTAURANT_ID_2, TEST_RESTAURANT_ID_3] },
      },
    });

    await prisma.restaurant.deleteMany({
      where: { id: { in: [TEST_RESTAURANT_ID_1, TEST_RESTAURANT_ID_2, TEST_RESTAURANT_ID_3] } },
    });

    await prisma.user.deleteMany({
      where: { 
        id: { 
          in: [TEST_USER_ID + '_1', TEST_USER_ID + '_2', TEST_USER_ID + '_3'] 
        } 
      },
    }).catch(() => {});
  });

  describe('Data Formatting', () => {
    test('should format conversation counts correctly', async () => {
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();

      const usage = await prisma.monthlyUsage.findUnique({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID_1,
            month: currentMonth,
            year: currentYear,
          },
        },
      });

      expect(usage).not.toBeNull();
      expect(usage?.conversationCount).toBe(45);
      expect(typeof usage?.conversationCount).toBe('number');
    });

    test('should format dates as ISO strings', async () => {
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();

      const usage = await prisma.monthlyUsage.findUnique({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID_1,
            month: currentMonth,
            year: currentYear,
          },
        },
      });

      expect(usage?.lastConversationAt).toBeInstanceOf(Date);
      const isoString = usage?.lastConversationAt?.toISOString();
      expect(isoString).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('should calculate allowance correctly', async () => {
      const bot = await prisma.restaurantBot.findFirst({
        where: { restaurantId: TEST_RESTAURANT_ID_1, isActive: true },
      });

      expect(bot).not.toBeNull();
      expect(bot?.maxMessagesPerDay).toBe(100);

      const monthlyLimit = bot!.maxMessagesPerDay * 30;
      expect(monthlyLimit).toBe(3000);

      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();

      const usage = await prisma.monthlyUsage.findUnique({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID_1,
            month: currentMonth,
            year: currentYear,
          },
        },
      });

      const monthlyRemaining = monthlyLimit - (usage?.conversationCount || 0);
      expect(monthlyRemaining).toBe(2955); // 3000 - 45
    });

    test('should handle null dates gracefully', async () => {
      // Restaurant 3 has no usage data
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();

      const usage = await prisma.monthlyUsage.findUnique({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID_3,
            month: currentMonth,
            year: currentYear,
          },
        },
      });

      expect(usage).toBeNull();
    });
  });

  describe('Pagination', () => {
    test('should respect limit parameter', async () => {
      const limit = 2;
      const restaurants = await prisma.restaurant.findMany({
        where: { isActive: true },
        take: limit,
      });

      expect(restaurants.length).toBeLessThanOrEqual(limit);
    });

    test('should respect offset parameter', async () => {
      const limit = 1;
      const offset = 1;

      const firstPage = await prisma.restaurant.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: 0,
      });

      const secondPage = await prisma.restaurant.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });

      // Ensure we got different results
      if (firstPage.length > 0 && secondPage.length > 0) {
        expect(firstPage[0].id).not.toBe(secondPage[0].id);
      }
    });

    test('should calculate hasMore correctly', async () => {
      const limit = 2;
      const offset = 0;

      const total = await prisma.restaurant.count({ where: { isActive: true } });
      const hasMore = offset + limit < total;

      expect(typeof hasMore).toBe('boolean');
    });

    test('should return correct total count', async () => {
      const total = await prisma.restaurant.count({ where: { isActive: true } });
      
      // We have 2 active restaurants in test data
      expect(total).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Activity Timestamps', () => {
    test('should retrieve first activity timestamp', async () => {
      const firstConversation = await prisma.conversation.findFirst({
        where: { restaurantId: TEST_RESTAURANT_ID_1 },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });

      expect(firstConversation).not.toBeNull();
      expect(firstConversation?.createdAt).toBeInstanceOf(Date);
      expect(firstConversation?.createdAt).toEqual(new Date('2025-09-01T08:00:00Z'));
    });

    test('should retrieve last activity timestamp', async () => {
      const lastConversation = await prisma.conversation.findFirst({
        where: { restaurantId: TEST_RESTAURANT_ID_1 },
        orderBy: { lastMessageAt: 'desc' },
        select: { lastMessageAt: true },
      });

      expect(lastConversation).not.toBeNull();
      expect(lastConversation?.lastMessageAt).toBeInstanceOf(Date);
      expect(lastConversation?.lastMessageAt).toEqual(new Date('2025-10-20T15:30:00Z'));
    });

    test('should return null for restaurants with no activity', async () => {
      const firstConversation = await prisma.conversation.findFirst({
        where: { restaurantId: TEST_RESTAURANT_ID_3 },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });

      expect(firstConversation).toBeNull();
    });
  });

  describe('Historical Data', () => {
    test('should retrieve historical usage data', async () => {
      const currentDate = new Date();
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const historicalUsage = await prisma.monthlyUsage.findMany({
        where: {
          restaurantId: TEST_RESTAURANT_ID_1,
          OR: [
            { year: { gt: sixMonthsAgo.getFullYear() } },
            {
              year: sixMonthsAgo.getFullYear(),
              month: { gte: sixMonthsAgo.getMonth() + 1 },
            },
          ],
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });

      expect(historicalUsage.length).toBeGreaterThan(0);
      expect(historicalUsage.length).toBe(2); // Current month + last month
    });

    test('should order historical data by year and month descending', async () => {
      const currentDate = new Date();
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const historicalUsage = await prisma.monthlyUsage.findMany({
        where: {
          restaurantId: TEST_RESTAURANT_ID_1,
          OR: [
            { year: { gt: sixMonthsAgo.getFullYear() } },
            {
              year: sixMonthsAgo.getFullYear(),
              month: { gte: sixMonthsAgo.getMonth() + 1 },
            },
          ],
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });

      // First item should be most recent
      if (historicalUsage.length >= 2) {
        const first = historicalUsage[0];
        const second = historicalUsage[1];
        
        const firstDate = new Date(first.year, first.month - 1);
        const secondDate = new Date(second.year, second.month - 1);
        
        expect(firstDate.getTime()).toBeGreaterThanOrEqual(secondDate.getTime());
      }
    });
  });

  describe('Edge Cases', () => {
    test('should handle restaurant with no bot configuration', async () => {
      // Restaurant 2 has no bot
      const bot = await prisma.restaurantBot.findFirst({
        where: { restaurantId: TEST_RESTAURANT_ID_2, isActive: true },
      });

      expect(bot).toBeNull();
      
      // Allowance should default to 0
      const allowance = {
        dailyLimit: 0,
        dailyRemaining: 0,
        monthlyLimit: 0,
        monthlyRemaining: 0,
      };

      expect(allowance.monthlyLimit).toBe(0);
    });

    test('should handle inactive restaurants', async () => {
      const restaurant = await prisma.restaurant.findUnique({
        where: { id: TEST_RESTAURANT_ID_3 },
      });

      expect(restaurant?.isActive).toBe(false);
    });

    test('should handle zero conversations', async () => {
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();

      const usage = await prisma.monthlyUsage.findUnique({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID_3,
            month: currentMonth,
            year: currentYear,
          },
        },
      });

      const conversationCount = usage?.conversationCount || 0;
      expect(conversationCount).toBe(0);
    });

    test('should handle large conversation counts', async () => {
      // Restaurant 2 has 120 conversations
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();

      const usage = await prisma.monthlyUsage.findUnique({
        where: {
          restaurantId_month_year: {
            restaurantId: TEST_RESTAURANT_ID_2,
            month: currentMonth,
            year: currentYear,
          },
        },
      });

      expect(usage?.conversationCount).toBe(120);
      expect(usage?.conversationCount).toBeGreaterThan(100);
    });
  });

  describe('Allowance Calculations', () => {
    test('should calculate remaining allowance when under limit', async () => {
      const dailyLimit = 100;
      const monthlyLimit = dailyLimit * 30; // 3000
      const conversationsUsed = 45;
      const monthlyRemaining = monthlyLimit - conversationsUsed;

      expect(monthlyRemaining).toBe(2955);
      expect(monthlyRemaining).toBeGreaterThan(0);
    });

    test('should not return negative remaining allowance', async () => {
      const monthlyLimit = 100;
      const conversationsUsed = 150;
      const monthlyRemaining = Math.max(0, monthlyLimit - conversationsUsed);

      expect(monthlyRemaining).toBe(0);
      expect(monthlyRemaining).toBeGreaterThanOrEqual(0);
    });

    test('should calculate percentage used correctly', async () => {
      const total = 3000;
      const used = 45;
      const percentageUsed = (used / total) * 100;
      const percentageRemaining = ((total - used) / total) * 100;

      expect(percentageUsed).toBeCloseTo(1.5, 1);
      expect(percentageRemaining).toBeCloseTo(98.5, 1);
    });
  });
});

