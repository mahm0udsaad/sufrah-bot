/**
 * Usage Tracking Service
 * Captures and persists conversation session counts to monthly usage table
 */

import { prisma } from "../db/client";
import { detectSession } from "./sessionDetection";

export interface MonthlyUsageRecord {
  id: string;
  restaurantId: string;
  month: number;
  year: number;
  conversationCount: number;
  lastConversationAt: Date | null;
}

export interface TrackUsageParams {
  restaurantId: string;
  conversationId: string;
  eventType?: string;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}

/**
 * Tracks a message and increments usage counters if it's a new session
 * 
 * @param restaurantId - The restaurant ID
 * @param customerWa - The customer WhatsApp number
 * @param messageTimestamp - The timestamp of the message (defaults to now)
 * @returns The updated monthly usage record and session info
 */
export async function trackMessage(
  restaurantId: string,
  customerWa: string,
  messageTimestamp: Date = new Date()
): Promise<{
  monthlyUsage: MonthlyUsageRecord;
  sessionInfo: {
    isNewSession: boolean;
    sessionId: string;
  };
}> {
  // Detect if this is a new session
  const sessionInfo = await detectSession(
    restaurantId,
    customerWa,
    messageTimestamp
  );

  // Get month and year for the monthly usage record
  const month = messageTimestamp.getMonth() + 1; // getMonth() returns 0-11
  const year = messageTimestamp.getFullYear();

  // If it's a new session, increment the monthly counter
  if (sessionInfo.isNewSession) {
    const monthlyUsage = await incrementMonthlyUsage(
      restaurantId,
      month,
      year,
      messageTimestamp
    );

    return {
      monthlyUsage,
      sessionInfo: {
        isNewSession: true,
        sessionId: sessionInfo.sessionId,
      },
    };
  }

  // Not a new session, just return current usage without incrementing
  const currentUsage = await getOrCreateMonthlyUsage(
    restaurantId,
    month,
    year
  );

  return {
    monthlyUsage: currentUsage,
    sessionInfo: {
      isNewSession: false,
      sessionId: sessionInfo.sessionId,
    },
  };
}

/**
 * Gets or creates a monthly usage record for a restaurant
 * 
 * @param restaurantId - The restaurant ID
 * @param month - The month (1-12)
 * @param year - The year
 * @returns The monthly usage record
 */
export async function getOrCreateMonthlyUsage(
  restaurantId: string,
  month: number,
  year: number
): Promise<MonthlyUsageRecord> {
  const existing = await prisma.monthlyUsage.findUnique({
    where: {
      restaurantId_month_year: {
        restaurantId,
        month,
        year,
      },
    },
  });

  if (existing) {
    return existing;
  }

  return await prisma.monthlyUsage.create({
    data: {
      restaurantId,
      month,
      year,
      conversationCount: 0,
    },
  });
}

/**
 * Increments the monthly usage counter for a restaurant
 * 
 * @param restaurantId - The restaurant ID
 * @param month - The month (1-12)
 * @param year - The year
 * @param timestamp - The timestamp of the conversation
 * @returns The updated monthly usage record
 */
export async function incrementMonthlyUsage(
  restaurantId: string,
  month: number,
  year: number,
  timestamp: Date = new Date()
): Promise<MonthlyUsageRecord> {
  const record = await prisma.monthlyUsage.upsert({
    where: {
      restaurantId_month_year: {
        restaurantId,
        month,
        year,
      },
    },
    update: {
      conversationCount: {
        increment: 1,
      },
      lastConversationAt: timestamp,
    },
    create: {
      restaurantId,
      month,
      year,
      conversationCount: 1,
      lastConversationAt: timestamp,
    },
  });

  return record;
}

/**
 * Gets monthly usage for a restaurant
 * 
 * @param restaurantId - The restaurant ID
 * @param month - The month (1-12)
 * @param year - The year
 * @returns The monthly usage record or null if not found
 */
export async function getMonthlyUsage(
  restaurantId: string,
  month: number,
  year: number
): Promise<MonthlyUsageRecord | null> {
  return await prisma.monthlyUsage.findUnique({
    where: {
      restaurantId_month_year: {
        restaurantId,
        month,
        year,
      },
    },
  });
}

/**
 * Gets current month's usage for a restaurant
 * 
 * @param restaurantId - The restaurant ID
 * @param referenceDate - The reference date (defaults to now)
 * @returns The monthly usage record
 */
export async function getCurrentMonthUsage(
  restaurantId: string,
  referenceDate: Date = new Date()
): Promise<MonthlyUsageRecord> {
  const month = referenceDate.getMonth() + 1;
  const year = referenceDate.getFullYear();

  return await getOrCreateMonthlyUsage(restaurantId, month, year);
}

/**
 * Gets usage history for a restaurant
 * 
 * @param restaurantId - The restaurant ID
 * @param monthsBack - Number of months to look back (defaults to 12)
 * @returns Array of monthly usage records
 */
export async function getUsageHistory(
  restaurantId: string,
  monthsBack: number = 12
): Promise<MonthlyUsageRecord[]> {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - monthsBack);

  const startMonth = startDate.getMonth() + 1;
  const startYear = startDate.getFullYear();

  // Get all usage records for this restaurant
  const records = await prisma.monthlyUsage.findMany({
    where: {
      restaurantId,
      OR: [
        { year: { gt: startYear } },
        { year: startYear, month: { gte: startMonth } },
      ],
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  return records;
}

/**
 * Resets monthly usage for a restaurant (useful for testing)
 * 
 * @param restaurantId - The restaurant ID
 * @param month - The month (1-12)
 * @param year - The year
 */
export async function resetMonthlyUsage(
  restaurantId: string,
  month: number,
  year: number
): Promise<void> {
  await prisma.monthlyUsage.update({
    where: {
      restaurantId_month_year: {
        restaurantId,
        month,
        year,
      },
    },
    data: {
      conversationCount: 0,
      lastConversationAt: null,
    },
  });
}

/**
 * Tracks usage events triggered outside inbound message flow (e.g., queued outbound sends).
 * Currently proxies to trackMessage using the conversation's customer WhatsApp number.
 */
export async function trackUsage(params: TrackUsageParams): Promise<void> {
  const { restaurantId, conversationId, timestamp = new Date() } = params;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { customerWa: true },
  });

  if (!conversation?.customerWa) {
    console.warn(
      `⚠️ [UsageTracking] Unable to track usage for conversation ${conversationId}: missing customer WA`
    );
    return;
  }

  await trackMessage(restaurantId, conversation.customerWa, timestamp);
}

/**
 * Records a positive usage adjustment (e.g., admin renewal +1000) for the current month.
 * This does not change historical usage; quota computation will add these adjustments to the plan limit.
 */
export async function addUsageAdjustment(
  restaurantId: string,
  amount: number = 1000,
  type: string = 'RENEW',
  reason?: string,
  referenceDate: Date = new Date()
): Promise<void> {
  const month = referenceDate.getMonth() + 1;
  const year = referenceDate.getFullYear();

  await prisma.usageAdjustment.create({
    data: {
      restaurantId,
      month,
      year,
      amount,
      type,
      reason,
    },
  });
}

/**
 * Sums all adjustments for the given restaurant in the given month/year.
 */
export async function getMonthlyAdjustmentsTotal(
  restaurantId: string,
  month: number,
  year: number
): Promise<number> {
  try {
    const result = await (prisma as any).usageAdjustment.aggregate({
      where: { restaurantId, month, year },
      _sum: { amount: true },
    });
    return result._sum?.amount ?? 0;
  } catch (error: any) {
    // If the adjustments table is not yet migrated (P2021), default to 0
    if (error?.code === 'P2021') {
      return 0;
    }
    throw error;
  }
}

