/**
 * Dashboard metrics aggregation service
 * Provides data for the tenant overview endpoint
 */

import { prisma } from '../db/client';
import { checkQuota } from './quotaEnforcement';

interface TenantOverview {
  activeConversations: number;
  pendingOrders: number;
  slaBreaches: number;
  quotaUsage: {
    used: number;
    limit: number;
    remaining: number;
    percentUsed: number;
  };
  ratingTrend: {
    averageRating: number;
    totalRatings: number;
    trend: 'up' | 'down' | 'stable';
    changePercent: number;
  };
  recentActivity: {
    messagesLast24h: number;
    ordersLast24h: number;
    conversationsLast24h: number;
  };
}

/**
 * Get comprehensive overview metrics for a tenant
 */
export async function getTenantOverview(restaurantId: string): Promise<TenantOverview> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Parallel queries for efficiency
  const [
    activeConversations,
    pendingOrders,
    quotaStatus,
    recentRatings,
    previousRatings,
    messagesLast24h,
    ordersLast24h,
    conversationsLast24h,
  ] = await Promise.all([
    // Active conversations
    prisma.conversation.count({
      where: {
        restaurantId,
        status: 'active',
      },
    }),

    // Pending orders (DRAFT, CONFIRMED, PREPARING, OUT_FOR_DELIVERY)
    prisma.order.count({
      where: {
        restaurantId,
        status: {
          in: ['DRAFT', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'],
        },
      },
    }),

    // Quota usage
    checkQuota(restaurantId, undefined, now),

    // Ratings in last 30 days
    prisma.order.findMany({
      where: {
        restaurantId,
        rating: { not: null },
        ratedAt: { gte: thirtyDaysAgo },
      },
      select: { rating: true, ratedAt: true },
    }),

    // Ratings from previous 30 days (for trend comparison)
    prisma.order.findMany({
      where: {
        restaurantId,
        rating: { not: null },
        ratedAt: {
          gte: new Date(thirtyDaysAgo.getTime() - 30 * 24 * 60 * 60 * 1000),
          lt: thirtyDaysAgo,
        },
      },
      select: { rating: true },
    }),

    // Messages in last 24h
    prisma.message.count({
      where: {
        restaurantId,
        createdAt: { gte: oneDayAgo },
      },
    }),

    // Orders in last 24h
    prisma.order.count({
      where: {
        restaurantId,
        createdAt: { gte: oneDayAgo },
      },
    }),

    // Conversations started in last 24h
    prisma.conversation.count({
      where: {
        restaurantId,
        createdAt: { gte: oneDayAgo },
      },
    }),
  ]);

  // Calculate rating trend
  const recentAvg =
    recentRatings.length > 0
      ? recentRatings.reduce((sum, o) => sum + (o.rating || 0), 0) / recentRatings.length
      : 0;

  const previousAvg =
    previousRatings.length > 0
      ? previousRatings.reduce((sum, o) => sum + (o.rating || 0), 0) / previousRatings.length
      : recentAvg;

  const changePercent = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg) * 100 : 0;
  
  let trend: 'up' | 'down' | 'stable' = 'stable';
  if (Math.abs(changePercent) > 5) {
    trend = changePercent > 0 ? 'up' : 'down';
  }

  // Calculate SLA breaches (conversations with no response in >15 minutes)
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const slaBreaches = await prisma.conversation.count({
    where: {
      restaurantId,
      status: 'active',
      lastMessageAt: { lt: fifteenMinutesAgo },
      unreadCount: { gt: 0 },
    },
  });

  return {
    activeConversations,
    pendingOrders,
    slaBreaches,
    quotaUsage: {
      used: quotaStatus.used,
      limit: quotaStatus.limit,
      remaining: quotaStatus.remaining,
      percentUsed: quotaStatus.limit > 0 ? (quotaStatus.used / quotaStatus.limit) * 100 : 0,
    },
    ratingTrend: {
      averageRating: Math.round(recentAvg * 10) / 10,
      totalRatings: recentRatings.length,
      trend,
      changePercent: Math.round(changePercent * 10) / 10,
    },
    recentActivity: {
      messagesLast24h,
      ordersLast24h,
      conversationsLast24h,
    },
  };
}

/**
 * Get bot health metrics
 */
export async function getBotHealthMetrics(restaurantId: string) {
  const bot = await prisma.restaurantBot.findFirst({
    where: { restaurantId, isActive: true },
  });

  if (!bot) {
    return null;
  }

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Get webhook logs to determine health
  const [recentWebhookErrors, webhooksLastHour, messagesLastHour] = await Promise.all([
    prisma.webhookLog.count({
      where: {
        restaurantId,
        statusCode: { gte: 400 },
        createdAt: { gte: oneHourAgo },
      },
    }),

    prisma.webhookLog.count({
      where: {
        restaurantId,
        createdAt: { gte: oneHourAgo },
      },
    }),

    prisma.message.count({
      where: {
        restaurantId,
        direction: 'OUT',
        createdAt: { gte: oneHourAgo },
      },
    }),
  ]);

  // Get last webhook timestamp
  const lastWebhook = await prisma.webhookLog.findFirst({
    where: { restaurantId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  // Determine webhook health
  const webhookHealthy = recentWebhookErrors === 0 && webhooksLastHour > 0;
  const errorRate = webhooksLastHour > 0 ? (recentWebhookErrors / webhooksLastHour) * 100 : 0;

  return {
    botId: bot.id,
    botName: bot.name,
    whatsappNumber: bot.whatsappNumber,
    status: bot.status,
    isVerified: !!bot.verifiedAt,
    verifiedAt: bot.verifiedAt?.toISOString() || null,
    lastWebhookAt: lastWebhook?.createdAt.toISOString() || null,
    webhookHealth: {
      healthy: webhookHealthy,
      errorRate: Math.round(errorRate * 10) / 10,
      requestsLastHour: webhooksLastHour,
      errorsLastHour: recentWebhookErrors,
    },
    rateLimits: {
      maxMessagesPerMin: bot.maxMessagesPerMin,
      maxMessagesPerDay: bot.maxMessagesPerDay,
    },
    messagesLastHour,
  };
}

/**
 * Get conversation summary statistics
 */
export async function getConversationSummary(restaurantId: string, limit: number = 20, offset: number = 0) {
  const now = new Date();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

  const [conversations, totalCount] = await Promise.all([
    prisma.conversation.findMany({
      where: {
        restaurantId,
        status: 'active',
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
      skip: offset,
    }),

    prisma.conversation.count({
      where: {
        restaurantId,
        status: 'active',
      },
    }),
  ]);

  const summaries = conversations.map((conv) => {
    const lastMessage = conv.messages[0];
    const timeSinceLastMessage = now.getTime() - conv.lastMessageAt.getTime();
    const slaMinutesRemaining = Math.max(0, 15 - Math.floor(timeSinceLastMessage / 60000));
    const isSlaBreached = timeSinceLastMessage > 15 * 60 * 1000 && conv.unreadCount > 0;

    return {
      id: conv.id,
      customerWa: conv.customerWa,
      customerName: conv.customerName || 'Unknown',
      lastMessageAt: conv.lastMessageAt.toISOString(),
      lastMessagePreview: lastMessage?.content.substring(0, 100) || '',
      unreadCount: conv.unreadCount,
      isBotActive: conv.isBotActive,
      channel: conv.isBotActive ? 'bot' : 'agent',
      escalated: !conv.isBotActive,
      slaStatus: {
        breached: isSlaBreached,
        minutesRemaining: slaMinutesRemaining,
      },
    };
  });

  return {
    conversations: summaries,
    pagination: {
      total: totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount,
    },
  };
}

/**
 * Get order feed with real-time status
 */
export async function getOrderFeed(restaurantId: string, limit: number = 20, offset: number = 0) {
  const [orders, totalCount] = await Promise.all([
    prisma.order.findMany({
      where: {
        restaurantId,
        status: { not: 'DRAFT' },
      },
      include: {
        items: true,
        conversation: {
          select: {
            customerWa: true,
            customerName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),

    prisma.order.count({
      where: {
        restaurantId,
        status: { not: 'DRAFT' },
      },
    }),
  ]);

  const now = new Date();

  const orderSummaries = orders.map((order) => {
    const timeSinceCreation = now.getTime() - order.createdAt.getTime();
    const prepTimeMins = Math.floor(timeSinceCreation / 60000);

    // Determine if order requires attention
    const isLate = order.status === 'PREPARING' && prepTimeMins > 45;
    const awaitingPayment = order.status === 'CONFIRMED' && !order.paymentMethod;
    const requiresReview = order.status === 'CONFIRMED' && timeSinceCreation > 5 * 60 * 1000;

    return {
      id: order.id,
      orderReference: order.orderReference,
      status: order.status,
      statusStage: order.statusStage,
      customerName: order.conversation.customerName || 'Unknown',
      customerWa: order.conversation.customerWa,
      totalCents: order.totalCents,
      currency: order.currency,
      itemCount: order.items.length,
      orderType: order.orderType,
      paymentMethod: order.paymentMethod,
      branchName: order.branchName,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      preparationTime: prepTimeMins,
      alerts: {
        isLate,
        awaitingPayment,
        requiresReview,
      },
    };
  });

  return {
    orders: orderSummaries,
    pagination: {
      total: totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount,
    },
  };
}

