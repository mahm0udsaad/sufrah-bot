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
function authenticate(req: Request): AuthResult {
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
  const quotaStatus = await checkQuota(restaurantId, undefined, new Date(currentYear, currentMonth - 1, 1));

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
 * Handle GET /api/usage
 * Returns usage stats for a single restaurant or all restaurants (admin)
 */
export async function handleUsageApi(req: Request, url: URL): Promise<Response | null> {
  if (req.method !== 'GET') {
    return null;
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

    const allowance = await calculateRemainingAllowance(restaurantId, currentMonth, currentYear);
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
