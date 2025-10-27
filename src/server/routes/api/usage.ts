import { jsonResponse } from '../../http';
import { DASHBOARD_PAT, BOT_API_KEY } from '../../../config';
import { prisma } from '../../../db/client';
import { getRestaurantById } from '../../../db/restaurantService';
import { checkQuota } from '../../../services/quotaEnforcement';

type AuthResult = { ok: boolean; restaurantId?: string; isAdmin?: boolean; error?: string };

/**
 * Authenticate request for usage API
 * Supports:
 * - PAT with X-Restaurant-Id header (dashboard access)
 * - API Key for admin access (list all restaurants)
 */
function authenticate(req: any): AuthResult {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';

  let token = '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearer && bearer[1]) token = bearer[1].trim();

  // PAT authentication (specific restaurant)
  if (DASHBOARD_PAT && token && token === DASHBOARD_PAT) {
    const restaurantId = (req.headers.get('x-restaurant-id') || '').trim();
    if (!restaurantId) {
      return { ok: false, error: 'X-Restaurant-Id header is required for PAT' };
    }
    return { ok: true, restaurantId };
  }

  // API Key authentication (admin access)
  if (BOT_API_KEY && apiKeyHeader && apiKeyHeader === BOT_API_KEY) {
    return { ok: true, isAdmin: true };
  }

  return { ok: false, error: 'Unauthorized' };
}

/**
 * Calculate remaining allowance based on current usage and bot limits
 */
async function calculateRemainingAllowance(
  restaurantId: string,
  currentMonth: number,
  currentYear: number
) {
  // Get quota limits using the shared enforcement service so dashboard matches backend enforcement
  const quotaStatus = await checkQuota(restaurantId);

  const monthlyLimit = quotaStatus.limit;
  const monthlyRemaining = quotaStatus.remaining;

  // Get restaurant bot config (if available) for daily limit context
  const bot = await prisma.restaurantBot.findFirst({
    where: {
      restaurantId,
      isActive: true,
    },
  });

  const derivedDailyLimit = bot?.maxMessagesPerDay ?? (monthlyLimit > 0 ? Math.min(monthlyLimit, 1000) : monthlyLimit);
  const dailyLimit = derivedDailyLimit ?? 0;
  const dailyRemaining = dailyLimit >= 0 ? dailyLimit : -1;

  return {
    dailyLimit,
    dailyRemaining,
    monthlyLimit,
    monthlyRemaining,
  };
}

/**
 * Get first and last activity timestamps for a restaurant
 */
async function getActivityTimestamps(restaurantId: string) {
  const firstConversation = await prisma.conversation.findFirst({
    where: { restaurantId },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });

  const lastConversation = await prisma.conversation.findFirst({
    where: { restaurantId },
    orderBy: { lastMessageAt: 'desc' },
    select: { lastMessageAt: true },
  });

  return {
    firstActivity: firstConversation?.createdAt || null,
    lastActivity: lastConversation?.lastMessageAt || null,
  };
}

/**
 * Helpers for detailed usage
 */
function getMonthRange(reference: Date): { start: Date; end: Date; days: number } {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 1, 0, 0, 0, 0);
  const days = new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate();
  return { start, end, days };
}

async function buildDailyBreakdown(restaurantId: string, referenceDate: Date) {
  const { start, days } = getMonthRange(referenceDate);
  const results: Array<{ date: string; conversationsStarted: number; messages: number }> = [];
  for (let i = 0; i < days; i++) {
    const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1, 0, 0, 0, 0);

    const [conversationsStarted, messages] = await Promise.all([
      prisma.conversationSession.count({
        where: { restaurantId, sessionStart: { gte: dayStart, lt: dayEnd } },
      }),
      prisma.message.count({ where: { restaurantId, createdAt: { gte: dayStart, lt: dayEnd } } }),
    ]);

    results.push({
      date: dayStart.toISOString().slice(0, 10),
      conversationsStarted,
      messages,
    });
  }
  return results;
}

async function buildAdjustments(restaurantId: string, referenceDate: Date) {
  const month = referenceDate.getMonth() + 1;
  const year = referenceDate.getFullYear();
  try {
    const adjustments = await (prisma as any).usageAdjustment.findMany({
      where: { restaurantId, month, year },
      orderBy: { createdAt: 'desc' },
    });
    return adjustments.map((a: any) => ({
      id: a.id,
      amount: a.amount,
      type: a.type,
      reason: a.reason || null,
      createdAt: a.createdAt.toISOString(),
    }));
  } catch (error: any) {
    if (error?.code === 'P2021') {
      return [];
    }
    throw error;
  }
}

async function buildRecentSessions(restaurantId: string, limit: number = 20) {
  const sessions = await prisma.conversationSession.findMany({
    where: { restaurantId },
    orderBy: { sessionStart: 'desc' },
    take: limit,
    select: {
      id: true,
      customerWa: true,
      sessionStart: true,
      sessionEnd: true,
      messageCount: true,
    },
  });
  return sessions.map((s) => ({
    id: s.id,
    customerWa: s.customerWa,
    sessionStart: s.sessionStart.toISOString(),
    sessionEnd: s.sessionEnd.toISOString(),
    messageCount: s.messageCount,
  }));
}

async function buildUsageDetailsPayload(restaurantId: string) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const [restaurant, usage, quota, firstLast, dailyBreakdown, adjustments, recentSessions, activeSessions] = await Promise.all([
    getRestaurantById(restaurantId),
    prisma.monthlyUsage.findUnique({
      where: { restaurantId_month_year: { restaurantId, month: currentMonth, year: currentYear } },
    }),
    checkQuota(restaurantId),
    getActivityTimestamps(restaurantId),
    buildDailyBreakdown(restaurantId, now),
    buildAdjustments(restaurantId, now),
    buildRecentSessions(restaurantId, 20),
    prisma.conversationSession.count({ where: { restaurantId, sessionEnd: { gt: now } } }),
  ]);

  if (!restaurant) return null;

  return {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    isActive: restaurant.isActive,
    quota: {
      used: quota.used,
      limit: quota.limit,
      effectiveLimit: quota.effectiveLimit ?? quota.limit,
      adjustedBy: quota.adjustedBy ?? 0,
      remaining: quota.remaining,
      usagePercent: quota.usagePercent ?? null,
      isNearingQuota: quota.isNearingQuota ?? false,
    },
    monthlyUsage: {
      month: currentMonth,
      year: currentYear,
      conversationCount: usage?.conversationCount || 0,
      lastConversationAt: usage?.lastConversationAt?.toISOString() || null,
    },
    firstActivity: firstLast.firstActivity?.toISOString() || null,
    lastActivity: firstLast.lastActivity?.toISOString() || null,
    activeSessionsCount: activeSessions,
    dailyBreakdown,
    adjustments,
    recentSessions,
  };
}

/**
 * Handle GET /api/usage
 * Returns usage stats for a single restaurant or all restaurants (admin)
 */
export async function handleUsageApi(req: any, url: any): Promise<any | null> {
  if (req.method !== 'GET') {
    return null;
  }

  // GET /api/usage/details (PAT only) - detailed view for one restaurant
  if (url.pathname === '/api/usage/details') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      const status = auth.error?.includes('required') ? 400 : 401;
      return jsonResponse({ error: auth.error || 'Unauthorized' }, status);
    }

    const payload = await buildUsageDetailsPayload(auth.restaurantId);
    if (!payload) return jsonResponse({ error: 'Restaurant not found' }, 404);
    return jsonResponse(payload);
  }

  // GET /api/usage/:restaurantId/details (admin only) - detailed view for one restaurant
  const detailsMatch = url.pathname.match(/^\/api\/usage\/([^/]+)\/details$/);
  if (detailsMatch) {
    const auth = authenticate(req);
    if (!auth.ok || !auth.isAdmin) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const restaurantId = detailsMatch[1];
    const payload = await buildUsageDetailsPayload(restaurantId);
    if (!payload) return jsonResponse({ error: 'Restaurant not found' }, 404);
    return jsonResponse(payload);
  }

  // GET /api/usage/alerts?threshold=0.9 - restaurants nearing quota (admin only)
  if (url.pathname === '/api/usage/alerts') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.isAdmin) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const threshold = Math.min(
      Math.max(parseFloat(url.searchParams.get('threshold') || '0.9'), 0),
      1
    );
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    // Only active restaurants
    const [restaurants, total] = await Promise.all([
      prisma.restaurant.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.restaurant.count({ where: { isActive: true } }),
    ]);

    const data = (
      await Promise.all(
        restaurants.map(async (r) => ({ r, quota: await checkQuota(r.id) }))
      )
    )
      .filter(({ quota }) => quota.effectiveLimit !== -1 && (quota.usagePercent ?? 0) >= threshold * 100)
      .map(({ r, quota }) => ({
        restaurantId: r.id,
        restaurantName: r.name,
        used: quota.used,
        limit: quota.effectiveLimit ?? quota.limit,
        remaining: quota.remaining,
        usagePercent: quota.usagePercent,
        isNearingQuota: quota.isNearingQuota,
        adjustedBy: quota.adjustedBy ?? 0,
      }));

    return jsonResponse({
      data,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
      threshold,
    });
  }

  // GET /api/usage - list all restaurants (admin only)
  if (url.pathname === '/api/usage') {
    const auth = authenticate(req);
    if (!auth.ok) {
      const status = auth.error?.includes('required') ? 400 : 401;
      return jsonResponse({ error: auth.error || 'Unauthorized' }, status);
    }

    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();

    // If admin, list all restaurants
    if (auth.isAdmin) {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);

      const [restaurants, totalCount] = await Promise.all([
        prisma.restaurant.findMany({
          where: { isActive: true },
          include: {
            monthlyUsage: {
              where: {
                month: currentMonth,
                year: currentYear,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.restaurant.count({ where: { isActive: true } }),
      ]);

      const results = await Promise.all(
        restaurants.map(async (restaurant) => {
          const usage = restaurant.monthlyUsage[0];
          const quotaStatus = await checkQuota(restaurant.id);
          const allowance = await calculateRemainingAllowance(
            restaurant.id,
            currentMonth,
            currentYear
          );
          const { firstActivity, lastActivity } = await getActivityTimestamps(restaurant.id);

          return {
            restaurantId: restaurant.id,
            restaurantName: restaurant.name,
            conversationsThisMonth: usage?.conversationCount || 0,
            lastConversationAt: usage?.lastConversationAt?.toISOString() || null,
            allowance,
            adjustedBy: quotaStatus.adjustedBy ?? 0,
            usagePercent: quotaStatus.usagePercent ?? null,
            isNearingQuota: quotaStatus.isNearingQuota ?? false,
            firstActivity: firstActivity?.toISOString() || null,
            lastActivity: lastActivity?.toISOString() || null,
            isActive: restaurant.isActive,
          };
        })
      );

      return jsonResponse({
        data: results,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
      });
    }

    // Single restaurant view
    if (auth.restaurantId) {
      const restaurant = await getRestaurantById(auth.restaurantId);
      if (!restaurant) {
        return jsonResponse({ error: 'Restaurant not found' }, 404);
      }

      const usage = await prisma.monthlyUsage.findUnique({
        where: {
          restaurantId_month_year: {
            restaurantId: auth.restaurantId,
            month: currentMonth,
            year: currentYear,
          },
        },
      });

      const quotaStatus = await checkQuota(auth.restaurantId);
      const allowance = await calculateRemainingAllowance(
        auth.restaurantId,
        currentMonth,
        currentYear
      );
      const { firstActivity, lastActivity } = await getActivityTimestamps(auth.restaurantId);

      return jsonResponse({
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        conversationsThisMonth: usage?.conversationCount || 0,
        lastConversationAt: usage?.lastConversationAt?.toISOString() || null,
        allowance,
        adjustedBy: quotaStatus.adjustedBy ?? 0,
        usagePercent: quotaStatus.usagePercent ?? null,
        isNearingQuota: quotaStatus.isNearingQuota ?? false,
        firstActivity: firstActivity?.toISOString() || null,
        lastActivity: lastActivity?.toISOString() || null,
        isActive: restaurant.isActive,
      });
    }

    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  // GET /api/usage/:restaurantId - specific restaurant (admin only)
  const restaurantMatch = url.pathname.match(/^\/api\/usage\/([^/]+)$/);
  if (restaurantMatch) {
    const auth = authenticate(req);
    if (!auth.ok || !auth.isAdmin) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const restaurantId = restaurantMatch[1];
    const restaurant = await getRestaurantById(restaurantId);
    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();

    const usage = await prisma.monthlyUsage.findUnique({
      where: {
        restaurantId_month_year: {
          restaurantId,
          month: currentMonth,
          year: currentYear,
        },
      },
    });

    const quotaStatus = await checkQuota(restaurantId);
    const allowance = await calculateRemainingAllowance(
      restaurantId,
      currentMonth,
      currentYear
    );
    const { firstActivity, lastActivity } = await getActivityTimestamps(restaurantId);

    // Get historical data (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const historicalUsage = await prisma.monthlyUsage.findMany({
      where: {
        restaurantId,
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

    return jsonResponse({
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      conversationsThisMonth: usage?.conversationCount || 0,
      lastConversationAt: usage?.lastConversationAt?.toISOString() || null,
      allowance,
      adjustedBy: quotaStatus.adjustedBy ?? 0,
      usagePercent: quotaStatus.usagePercent ?? null,
      isNearingQuota: quotaStatus.isNearingQuota ?? false,
      firstActivity: firstActivity?.toISOString() || null,
      lastActivity: lastActivity?.toISOString() || null,
      isActive: restaurant.isActive,
      history: historicalUsage.map((h) => ({
        month: h.month,
        year: h.year,
        conversationCount: h.conversationCount,
        lastConversationAt: h.lastConversationAt?.toISOString() || null,
      })),
    });
  }

  return null;
}
