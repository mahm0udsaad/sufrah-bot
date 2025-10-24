/**
 * Admin API for internal dashboard
 * Provides tenant metrics and system performance data
 */

import { jsonResponse } from '../../http';
import { BOT_API_KEY } from '../../../config';
import { prisma } from '../../../db/client';
import { getLocaleFromRequest, createLocalizedResponse } from '../../../services/i18n';
import { getCacheReport } from '../../../services/templateCacheMetrics';
import { redis as redisClient } from '../../../redis/client';
import { authenticateDashboard } from '../../../utils/dashboardAuth';

type AuthResult = { ok: boolean; isAdmin?: boolean; error?: string };

function authenticate(req: Request): AuthResult {
  const apiKeyHeader = req.headers.get('x-api-key') || '';

  if (BOT_API_KEY && apiKeyHeader && apiKeyHeader === BOT_API_KEY) {
    return { ok: true, isAdmin: true };
  }

  return { ok: false, error: 'Unauthorized - Admin access required' };
}

/**
 * Handle GET /api/admin/metrics
 * Returns system-wide metrics for admin monitoring
 */
export async function handleAdminApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/admin/metrics
  if (url.pathname === '/api/admin/metrics' && req.method === 'GET') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.isAdmin) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Gather system-wide metrics
    const [
      totalRestaurants,
      activeRestaurants,
      totalBots,
      activeBots,
      verifiedBots,
      conversationsLast24h,
      messagesLast24h,
      ordersLast24h,
      webhookErrorsLast24h,
    ] = await Promise.all([
      prisma.restaurant.count(),
      prisma.restaurant.count({ where: { isActive: true } }),
      prisma.restaurantBot.count(),
      prisma.restaurantBot.count({ where: { isActive: true } }),
      prisma.restaurantBot.count({ where: { verifiedAt: { not: null } } }),
      prisma.conversation.count({ where: { createdAt: { gte: oneDayAgo } } }),
      prisma.message.count({ where: { createdAt: { gte: oneDayAgo } } }),
      prisma.order.count({ where: { createdAt: { gte: oneDayAgo } } }),
      prisma.webhookLog.count({
        where: {
          createdAt: { gte: oneDayAgo },
          statusCode: { gte: 400 },
        },
      }),
    ]);

    const templateCacheMetrics = await getCacheReport();

    // Get onboarding funnel
    const onboardingFunnel = {
      registered: totalRestaurants,
      profileCompleted: await prisma.restaurant.count({
        where: {
          name: { not: null },
          address: { not: null },
        },
      }),
      botSetup: totalBots,
      botVerified: verifiedBots,
      firstOrder: await prisma.restaurant.count({
        where: {
          orders: {
            some: {
              status: 'DELIVERED',
            },
          },
        },
      }),
    };

    // Get Redis health
    let redisHealth = {
      connected: false,
      latency: null as number | null,
    };

    try {
      const start = Date.now();
      await redisClient.ping();
      redisHealth = {
        connected: true,
        latency: Date.now() - start,
      };
    } catch (error) {
      redisHealth.connected = false;
    }

    // Get queue lengths (from Redis)
    let queueMetrics = {
      whatsappSendQueue: 0,
      outboundQueue: 0,
    };

    try {
      const [whatsappLen, outboundLen] = await Promise.all([
        redisClient.llen('whatsapp-send'),
        redisClient.llen('whatsapp-outbound'),
      ]);
      queueMetrics = {
        whatsappSendQueue: whatsappLen || 0,
        outboundQueue: outboundLen || 0,
      };
    } catch (error) {
      // Queue metrics unavailable
    }

    // Get restaurant activity distribution
    const restaurantsByStatus = await prisma.restaurant.groupBy({
      by: ['status'],
      _count: true,
    });

    const metrics = {
      overview: {
        totalRestaurants,
        activeRestaurants,
        totalBots,
        activeBots,
        botVerificationRate: totalBots > 0 ? Math.round((verifiedBots / totalBots) * 100) : 0,
      },
      activity: {
        conversationsLast24h,
        messagesLast24h,
        ordersLast24h,
        avgMessagesPerConversation: conversationsLast24h > 0 
          ? Math.round(messagesLast24h / conversationsLast24h) 
          : 0,
      },
      health: {
        webhookErrorsLast24h,
        webhookErrorRate: messagesLast24h > 0 
          ? Math.round((webhookErrorsLast24h / messagesLast24h) * 100 * 10) / 10 
          : 0,
        redisHealth,
        queueMetrics,
      },
      templateCache: templateCacheMetrics,
      onboardingFunnel,
      restaurantsByStatus: restaurantsByStatus.map((item) => ({
        status: item.status,
        count: item._count,
      })),
    };

    return jsonResponse(createLocalizedResponse(metrics, locale));
  }

  // GET /api/admin/restaurants - list all restaurants with key metrics
  if (url.pathname === '/api/admin/restaurants' && req.method === 'GET') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.isAdmin) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const [restaurants, totalCount] = await Promise.all([
      prisma.restaurant.findMany({
        include: {
          bots: {
            where: { isActive: true },
            select: {
              status: true,
              verifiedAt: true,
              whatsappNumber: true,
            },
          },
          _count: {
            select: {
              conversations: true,
              orders: true,
              messages: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),

      prisma.restaurant.count(),
    ]);

    const restaurantList = restaurants.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      isActive: r.isActive,
      bot: r.bots[0] || null,
      metrics: {
        totalConversations: r._count.conversations,
        totalOrders: r._count.orders,
        totalMessages: r._count.messages,
      },
      createdAt: r.createdAt.toISOString(),
    }));

    return jsonResponse(
      createLocalizedResponse(
        {
          restaurants: restaurantList,
          pagination: {
            total: totalCount,
            limit,
            offset,
            hasMore: offset + limit < totalCount,
          },
        },
        locale
      )
    );
  }

  return null;
}

