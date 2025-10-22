/**
 * Unit tests for session detection service
 * Tests 24-hour window logic, midnight rollover, and edge cases
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { prisma } from '../src/db/client';
import {
  detectSession,
  isSessionActive,
  getActiveSession,
  getSessionTimeRemaining,
  getSessionStats,
} from '../src/services/sessionDetection';

// Test data
const TEST_RESTAURANT_ID = 'test_restaurant_session_' + Date.now();
const TEST_CUSTOMER_WA = '+966500000001';
const TEST_CUSTOMER_WA_2 = '+966500000002';

describe('Session Detection Service', () => {
  // Clean up test data before and after tests
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

    // Clean up existing test sessions
    await prisma.conversationSession.deleteMany({
      where: {
        OR: [
          { restaurantId: TEST_RESTAURANT_ID },
          { customerWa: { in: [TEST_CUSTOMER_WA, TEST_CUSTOMER_WA_2] } },
        ],
      },
    });
  });

  afterEach(async () => {
    // Clean up test sessions
    await prisma.conversationSession.deleteMany({
      where: {
        OR: [
          { restaurantId: TEST_RESTAURANT_ID },
          { customerWa: { in: [TEST_CUSTOMER_WA, TEST_CUSTOMER_WA_2] } },
        ],
      },
    });

    // Clean up test restaurant
    await prisma.restaurant.delete({
      where: { id: TEST_RESTAURANT_ID },
    }).catch(() => {});
  });

  describe('detectSession', () => {
    test('should create new session for first message', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const result = await detectSession(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA, now);

      expect(result.isNewSession).toBe(true);
      expect(result.sessionId).toBeDefined();
      expect(result.sessionStart).toEqual(now);
      
      // Session should end 24 hours later
      const expectedEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      expect(result.sessionEnd).toEqual(expectedEnd);
    });

    test('should reuse active session for repeat messages', async () => {
      const firstMessageTime = new Date('2025-01-15T10:00:00Z');
      const secondMessageTime = new Date('2025-01-15T12:00:00Z'); // 2 hours later
      
      // First message creates session
      const firstResult = await detectSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        firstMessageTime
      );
      expect(firstResult.isNewSession).toBe(true);

      // Second message within 24h should reuse session
      const secondResult = await detectSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        secondMessageTime
      );
      
      expect(secondResult.isNewSession).toBe(false);
      expect(secondResult.sessionId).toBe(firstResult.sessionId);
      expect(secondResult.sessionStart).toEqual(firstResult.sessionStart);
      
      // Session end should be extended to 24h from second message
      const expectedExtendedEnd = new Date(secondMessageTime.getTime() + 24 * 60 * 60 * 1000);
      expect(secondResult.sessionEnd).toEqual(expectedExtendedEnd);
    });

    test('should create new session after 24 hours', async () => {
      const firstMessageTime = new Date('2025-01-15T10:00:00Z');
      const secondMessageTime = new Date('2025-01-16T10:00:01Z'); // 24h + 1s later
      
      // First message creates session
      const firstResult = await detectSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        firstMessageTime
      );
      expect(firstResult.isNewSession).toBe(true);

      // Second message after 24h should create new session
      const secondResult = await detectSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        secondMessageTime
      );
      
      expect(secondResult.isNewSession).toBe(true);
      expect(secondResult.sessionId).not.toBe(firstResult.sessionId);
      expect(secondResult.sessionStart).toEqual(secondMessageTime);
    });

    test('should handle midnight rollover correctly', async () => {
      const beforeMidnight = new Date('2025-01-15T23:30:00Z');
      const afterMidnight = new Date('2025-01-16T00:30:00Z'); // 1 hour later, next day
      
      // First message before midnight
      const firstResult = await detectSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        beforeMidnight
      );
      expect(firstResult.isNewSession).toBe(true);

      // Second message after midnight (but within 24h) should reuse session
      const secondResult = await detectSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        afterMidnight
      );
      
      expect(secondResult.isNewSession).toBe(false);
      expect(secondResult.sessionId).toBe(firstResult.sessionId);
    });

    test('should create new session exactly at 24h boundary', async () => {
      const firstMessageTime = new Date('2025-01-15T10:00:00Z');
      const exactlyOneDayLater = new Date('2025-01-16T10:00:00Z'); // Exactly 24h
      
      // First message creates session
      const firstResult = await detectSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        firstMessageTime
      );

      // Message exactly at 24h boundary should create new session
      const secondResult = await detectSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        exactlyOneDayLater
      );
      
      expect(secondResult.isNewSession).toBe(true);
      expect(secondResult.sessionId).not.toBe(firstResult.sessionId);
    });

    test('should track separate sessions for different customers', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      
      const customer1Result = await detectSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        now
      );
      
      const customer2Result = await detectSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA_2,
        now
      );
      
      expect(customer1Result.isNewSession).toBe(true);
      expect(customer2Result.isNewSession).toBe(true);
      expect(customer1Result.sessionId).not.toBe(customer2Result.sessionId);
    });

    test('should increment message count for each message in session', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      
      // First message
      const firstResult = await detectSession(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA, now);
      
      // Check message count in database
      const session1 = await prisma.conversationSession.findUnique({
        where: { id: firstResult.sessionId },
      });
      expect(session1?.messageCount).toBe(1);
      
      // Second message
      await detectSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        new Date(now.getTime() + 1000)
      );
      
      const session2 = await prisma.conversationSession.findUnique({
        where: { id: firstResult.sessionId },
      });
      expect(session2?.messageCount).toBe(2);
      
      // Third message
      await detectSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        new Date(now.getTime() + 2000)
      );
      
      const session3 = await prisma.conversationSession.findUnique({
        where: { id: firstResult.sessionId },
      });
      expect(session3?.messageCount).toBe(3);
    });

    test('should handle concurrent session creation gracefully', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      
      // Simulate concurrent requests by calling detectSession simultaneously
      // Both requests see no existing session and try to create one
      // One should succeed, the other should catch the unique constraint error and retry
      const [result1, result2, result3] = await Promise.all([
        detectSession(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA, now),
        detectSession(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA, now),
        detectSession(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA, now),
      ]);

      // All should reference the same session (one created, others retried)
      expect(result1.sessionId).toBe(result2.sessionId);
      expect(result2.sessionId).toBe(result3.sessionId);
      
      // Check that only one session was created
      const sessions = await prisma.conversationSession.findMany({
        where: {
          restaurantId: TEST_RESTAURANT_ID,
          customerWa: TEST_CUSTOMER_WA,
        },
      });
      
      expect(sessions.length).toBe(1);
      
      // Message count should be 3 (all three requests incremented)
      expect(sessions[0].messageCount).toBe(3);
    });
  });

  describe('isSessionActive', () => {
    test('should return true for session in the future', () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const sessionEnd = new Date('2025-01-16T10:00:00Z'); // 24h later
      
      expect(isSessionActive(sessionEnd, now)).toBe(true);
    });

    test('should return false for expired session', () => {
      const now = new Date('2025-01-16T10:00:01Z');
      const sessionEnd = new Date('2025-01-16T10:00:00Z'); // 1s ago
      
      expect(isSessionActive(sessionEnd, now)).toBe(false);
    });

    test('should return false for session ending exactly now', () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const sessionEnd = new Date('2025-01-15T10:00:00Z');
      
      expect(isSessionActive(sessionEnd, now)).toBe(false);
    });
  });

  describe('getActiveSession', () => {
    test('should return active session', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      
      // Create session
      const created = await detectSession(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA, now);
      
      // Retrieve active session
      const active = await getActiveSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        now
      );
      
      expect(active).not.toBeNull();
      expect(active?.id).toBe(created.sessionId);
    });

    test('should return null for expired session', async () => {
      const sessionTime = new Date('2025-01-15T10:00:00Z');
      const checkTime = new Date('2025-01-16T10:00:01Z'); // After expiry
      
      // Create session
      await detectSession(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA, sessionTime);
      
      // Check after expiry
      const active = await getActiveSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        checkTime
      );
      
      expect(active).toBeNull();
    });

    test('should return null when no session exists', async () => {
      const now = new Date('2025-01-15T10:00:00Z');
      
      const active = await getActiveSession(
        TEST_RESTAURANT_ID,
        TEST_CUSTOMER_WA,
        now
      );
      
      expect(active).toBeNull();
    });
  });

  describe('getSessionTimeRemaining', () => {
    test('should return correct time remaining', () => {
      const now = new Date('2025-01-15T10:00:00Z');
      const sessionEnd = new Date('2025-01-15T12:00:00Z'); // 2 hours later
      
      const remaining = getSessionTimeRemaining(sessionEnd, now);
      
      expect(remaining).toBe(2 * 60 * 60 * 1000); // 2 hours in ms
    });

    test('should return 0 for expired session', () => {
      const now = new Date('2025-01-15T12:00:00Z');
      const sessionEnd = new Date('2025-01-15T10:00:00Z'); // 2 hours ago
      
      const remaining = getSessionTimeRemaining(sessionEnd, now);
      
      expect(remaining).toBe(0);
    });
  });

  describe('getSessionStats', () => {
    test('should return correct statistics', async () => {
      const startDate = new Date('2025-01-15T00:00:00Z');
      const endDate = new Date('2025-01-16T00:00:00Z');
      
      // Create multiple sessions
      await detectSession(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA, new Date('2025-01-15T10:00:00Z'));
      await detectSession(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA, new Date('2025-01-15T10:30:00Z'));
      await detectSession(TEST_RESTAURANT_ID, TEST_CUSTOMER_WA_2, new Date('2025-01-15T11:00:00Z'));
      
      const stats = await getSessionStats(TEST_RESTAURANT_ID, startDate, endDate);
      
      expect(stats.totalSessions).toBe(2); // 2 unique sessions (customer 1 reused session)
      expect(stats.uniqueCustomers).toBe(2); // 2 different customers
      expect(stats.totalMessages).toBe(3); // 3 messages total
    });
  });
});

