/**
 * Dashboard API - Matches Sufrah Dashboard Developer Specifications
 * 
 * This file contains all dashboard API endpoints with exact response formats
 * as specified by the dashboard developer.
 */

import { jsonResponse } from '../../http';
import { prisma } from '../../../db/client';
import {
  getLocaleFromRequest,
  formatCurrency,
  formatRelativeTime,
  getOrderStatusDisplay,
  getCustomerDisplayName,
} from '../../../services/i18n';
import { checkQuota } from '../../../services/quotaEnforcement';
import { resolveRestaurantId } from '../../../utils/restaurantResolver';

/**
 * Get tenantId from query parameter and resolve to restaurantId
 */
async function getTenantAndRestaurantId(url: URL): Promise<{ 
  tenantId: string; 
  restaurantId: string; 
  restaurantName: string;
} | null> {
  const tenantId = url.searchParams.get('tenantId');
  if (!tenantId) {
    return null;
  }

  const resolved = await resolveRestaurantId(tenantId);
  if (!resolved) {
    return null;
  }

  return {
    tenantId: resolved.botId,
    restaurantId: resolved.restaurantId,
    restaurantName: resolved.botName || 'Restaurant',
  };
}

/**
 * GET /api/dashboard/overview
 * Dashboard Overview Page - All key metrics
 */
export async function handleDashboardOverview(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/dashboard/overview' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const locale = url.searchParams.get('locale') || 'en';
  const currency = url.searchParams.get('currency') || 'SAR';

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Parallel queries for efficiency
  const [
    activeConversations,
    pendingOrders,
    quotaStatus,
    recentRatings,
    messagesLast24h,
    ordersLast24h,
    conversationsLast24h,
    activityTimeline,
    topTemplates,
  ] = await Promise.all([
    // Active conversations
    prisma.conversation.count({
      where: { restaurantId: tenant.restaurantId, status: 'active' },
    }),

    // Pending orders
    prisma.order.count({
      where: {
        restaurantId: tenant.restaurantId,
        status: { in: ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'] },
      },
    }),

    // Quota usage
    checkQuota(tenant.restaurantId, undefined, now),

    // Recent ratings (last 30 days)
    prisma.order.findMany({
      where: {
        restaurantId: tenant.restaurantId,
        rating: { not: null },
        ratedAt: { gte: thirtyDaysAgo },
      },
      select: { rating: true, ratedAt: true },
    }),

    // Messages in last 24h
    prisma.message.count({
      where: {
        restaurantId: tenant.restaurantId,
        createdAt: { gte: oneDayAgo },
      },
    }),

    // Orders in last 24h
    prisma.order.count({
      where: {
        restaurantId: tenant.restaurantId,
        createdAt: { gte: oneDayAgo },
      },
    }),

    // Conversations in last 24h
    prisma.conversation.count({
      where: {
        restaurantId: tenant.restaurantId,
        createdAt: { gte: oneDayAgo },
      },
    }),

    // Activity timeline (last 7 days)
    (async () => {
      const days = [];
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      
      for (let i = 6; i >= 0; i--) {
        const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

        const [messages, orders] = await Promise.all([
          prisma.message.count({
            where: {
              restaurantId: tenant.restaurantId,
              createdAt: { gte: dayStart, lt: dayEnd },
            },
          }),
          prisma.order.count({
            where: {
              restaurantId: tenant.restaurantId,
              createdAt: { gte: dayStart, lt: dayEnd },
            },
          }),
        ]);

        days.push({
          day: dayNames[dayStart.getDay()],
          messages,
          orders,
          date: dayStart.toISOString().split('T')[0],
        });
      }

      return days;
    })(),

    // Top templates (most used)
    prisma.contentTemplateCache.groupBy({
      by: ['friendlyName'],
      _count: { friendlyName: true },
      orderBy: { _count: { friendlyName: 'desc' } },
      take: 5,
    }),
  ]);

  // Calculate SLA breaches
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const slaBreaches = await prisma.conversation.count({
    where: {
      restaurantId: tenant.restaurantId,
      status: 'active',
      lastMessageAt: { lt: fifteenMinutesAgo },
      unreadCount: { gt: 0 },
    },
  });

  // Calculate rating trend
  const ratingValues = recentRatings.map((r) => r.rating!).filter((r) => r != null);
  const averageRating = ratingValues.length > 0
    ? ratingValues.reduce((sum, r) => sum + r, 0) / ratingValues.length / 2 // Convert 1-10 to 1-5
    : 0;

  // Get previous period ratings for trend
  const previousPeriodStart = new Date(thirtyDaysAgo.getTime() - 30 * 24 * 60 * 60 * 1000);
  const previousRatings = await prisma.order.findMany({
    where: {
      restaurantId: tenant.restaurantId,
      rating: { not: null },
      ratedAt: { gte: previousPeriodStart, lt: thirtyDaysAgo },
    },
    select: { rating: true },
  });

  const previousAvg = previousRatings.length > 0
    ? previousRatings.reduce((sum, o) => sum + (o.rating || 0), 0) / previousRatings.length / 2
    : averageRating;

  const changePercent = previousAvg > 0 ? ((averageRating - previousAvg) / previousAvg) * 100 : 0;
  const trend = Math.abs(changePercent) > 2 ? (changePercent > 0 ? 'up' : 'down') : 'stable';

  // Format top templates
  const topTemplatesData = await Promise.all(
    topTemplates.map(async (t) => {
      const template = await prisma.contentTemplateCache.findFirst({
        where: { friendlyName: t.friendlyName },
        select: { friendlyName: true },
      });

      return {
        name: template?.friendlyName || t.friendlyName,
        usage: t._count.friendlyName,
        category: 'general',
      };
    })
  );

  const data = {
    restaurantName: tenant.restaurantName,
    activeConversations,
    pendingOrders,
    slaBreaches,
    recentActivity: {
      messagesLast24h,
      ordersLast24h,
      conversationsLast24h,
    },
    quotaUsage: {
      used: quotaStatus.used,
      limit: quotaStatus.limit,
      remaining: quotaStatus.remaining,
      percentUsed: quotaStatus.limit > 0 ? Math.round((quotaStatus.used / quotaStatus.limit) * 100 * 10) / 10 : 0,
    },
    activityTimeline,
    topTemplates: topTemplatesData,
    ratingTrend: {
      averageRating: Math.round(averageRating * 10) / 10,
      totalRatings: ratingValues.length,
      trend,
      changePercent: Math.round(changePercent * 10) / 10,
    },
  };

  return jsonResponse({ success: true, data });
}

/**
 * GET /api/orders/stats
 * Orders Statistics
 */
async function handleOrdersStats(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/orders/stats' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const locale = url.searchParams.get('locale') || 'en';
  const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [totalOrders, totalRevenue] = await Promise.all([
    prisma.order.count({
      where: {
        restaurantId: tenant.restaurantId,
        status: { not: 'DRAFT' },
        createdAt: { gte: startDate },
      },
    }),

    prisma.order.aggregate({
      where: {
        restaurantId: tenant.restaurantId,
        status: { in: ['DELIVERED'] },
        createdAt: { gte: startDate },
      },
      _sum: { totalCents: true },
    }),
  ]);

  const totalRevenueCents = totalRevenue._sum.totalCents || 0;
  const averageOrderValue = totalOrders > 0 ? totalRevenueCents / totalOrders : 0;

  const data = {
    totalOrders,
    totalRevenue: totalRevenueCents,
    averageOrderValue: Math.round(averageOrderValue),
    period: {
      days,
      startDate: startDate.toISOString(),
      endDate: new Date().toISOString(),
    },
  };

  return jsonResponse({ success: true, data });
}

/**
 * GET /api/orders
 * Get paginated orders list
 */
async function handleOrdersList(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/orders' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const locale = url.searchParams.get('locale') || 'en';
  const currency = url.searchParams.get('currency') || 'SAR';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const statusFilter = url.searchParams.get('status');

  const whereClause: any = {
    restaurantId: tenant.restaurantId,
    status: { not: 'DRAFT' },
  };

  if (statusFilter && statusFilter !== 'ALL') {
    whereClause.status = statusFilter;
  }

  const [orders, totalCount] = await Promise.all([
    prisma.order.findMany({
      where: whereClause,
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

    prisma.order.count({ where: whereClause }),
  ]);

  const now = new Date();

  const ordersData = orders.map((order) => {
    const timeSinceCreation = now.getTime() - order.createdAt.getTime();
    const prepTimeMins = Math.floor(timeSinceCreation / 60000);

    const isLate = order.status === 'PREPARING' && prepTimeMins > 45;
    const awaitingPayment = order.status === 'CONFIRMED' && order.paymentMethod === 'pending';
    const requiresReview = order.status === 'CONFIRMED' && timeSinceCreation > 5 * 60 * 1000;

    return {
      id: order.id,
      orderReference: order.orderReference,
      customerId: order.conversationId,
      customerName: order.conversation.customerName || 'Unknown Customer',
      customerPhone: order.conversation.customerWa,
      status: order.status,
      statusDisplay: getOrderStatusDisplay(order.status, locale as any),
      itemCount: order.items.length,
      subtotal: order.totalCents,
      deliveryFee: 0,
      tax: 0,
      total: order.totalCents,
      totalFormatted: formatCurrency(order.totalCents, currency as any, locale as any),
      currency: currency,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      createdAtRelative: formatRelativeTime(order.createdAt, locale as any),
      items: order.items.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.qty,
        unitPrice: item.unitCents,
        total: item.totalCents,
      })),
      deliveryAddress: order.deliveryAddress,
      notes: '',
      paymentMethod: order.paymentMethod || 'cash',
      paymentStatus: order.paymentMethod ? 'paid' : 'pending',
      alerts: {
        isLate,
        awaitingPayment,
        requiresReview,
      },
      estimatedDeliveryTime: null,
    };
  });

  const data = {
    orders: ordersData,
    pagination: {
      total: totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount,
    },
  };

  return jsonResponse({ success: true, data });
}

/**
 * POST /api/orders/:orderId/status
 * Update order status
 */
async function handleOrderStatusUpdate(req: Request, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (!match || req.method !== 'POST') {
    return null;
  }

  const orderId = match[1];
  const body: any = await req.json();

  const tenant = await getTenantAndRestaurantId(url);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  if (!body.status) {
    return jsonResponse({ success: false, error: 'status field is required' }, 400);
  }

  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      restaurantId: tenant.restaurantId,
    },
  });

  if (!order) {
    return jsonResponse({ success: false, error: 'Order not found' }, 404);
  }

  const statusStageMap: { [key: string]: number } = {
    CONFIRMED: 1,
    PREPARING: 2,
    OUT_FOR_DELIVERY: 3,
    DELIVERED: 4,
    CANCELLED: -1,
  };

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: body.status,
      statusStage: statusStageMap[body.status] || 0,
      updatedAt: new Date(),
    },
  });

  const data = {
    order: {
      id: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt.toISOString(),
    },
  };

  return jsonResponse({ success: true, data });
}

/**
 * GET /api/conversations
 * Get conversations list
 */
async function handleConversationsList(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/conversations' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const conversations = await prisma.conversation.findMany({
    where: {
      restaurantId: tenant.restaurantId,
      status: 'active',
    },
    orderBy: { lastMessageAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const data = {
    conversations: conversations.map((conv) => ({
      id: conv.id,
      customer_phone: conv.customerWa,
      customer_name: conv.customerName || 'Unknown',
      last_message_at: conv.lastMessageAt.toISOString(),
      last_message_preview: '', // Will be populated from messages
      unread_count: conv.unreadCount,
      is_bot_active: conv.isBotActive,
      status: conv.status,
      created_at: conv.createdAt.toISOString(),
    })),
  };

  return jsonResponse({ success: true, data });
}

/**
 * GET /api/conversations/:conversationId/messages
 * Get messages for a conversation
 */
async function handleConversationMessages(req: Request, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (!match || req.method !== 'GET') {
    return null;
  }

  const conversationId = match[1];
  const tenant = await getTenantAndRestaurantId(url);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      restaurantId: tenant.restaurantId,
    },
  });

  if (!conversation) {
    return jsonResponse({ success: false, error: 'Conversation not found' }, 404);
  }

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  const data = {
    messages: messages.map((msg) => {
      const metadata = msg.metadata as any;
      return {
        id: msg.id,
        conversation_id: msg.conversationId,
        from_phone: msg.direction === 'IN' ? conversation.customerWa : conversation.restaurantId,
        to_phone: msg.direction === 'IN' ? conversation.restaurantId : conversation.customerWa,
        message_type: msg.messageType,
        content: msg.content,
        media_url: msg.mediaUrl,
        timestamp: msg.createdAt.toISOString(),
        is_from_customer: msg.direction === 'IN',
        status: 'delivered',
        read_at: msg.createdAt.toISOString(),
        content_sid: metadata?.contentSid || null,
        variables: metadata?.variables || {},
        template_preview: metadata?.contentSid ? {
          sid: metadata.contentSid,
          friendlyName: 'template',
          language: 'ar',
          body: msg.content,
          contentType: 'twilio/text',
          buttons: [],
        } : null,
      };
    }),
  };

  return jsonResponse({ success: true, data });
}

/**
 * POST /api/conversations/:conversationId/messages
 * Send a message
 */
async function handleSendMessage(req: Request, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (!match || req.method !== 'POST') {
    return null;
  }

  const conversationId = match[1]!;
  const body: any = await req.json();

  const tenant = await getTenantAndRestaurantId(url);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  if (!body.content || !body.messageType) {
    return jsonResponse({ success: false, error: 'content and messageType are required' }, 400);
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      restaurantId: tenant.restaurantId,
    },
  });

  if (!conversation) {
    return jsonResponse({ success: false, error: 'Conversation not found' }, 404);
  }

  // Create message in database
  const message = await prisma.message.create({
    data: {
      conversationId: conversationId,
      restaurantId: tenant.restaurantId,
      direction: 'OUT',
      messageType: body.messageType,
      content: body.content,
      mediaUrl: body.mediaUrl || null,
    },
  });

  // Update conversation
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
    },
  });

  const data = {
    message: {
      id: message.id,
      conversation_id: message.conversationId,
      content: message.content,
      timestamp: message.createdAt.toISOString(),
      status: 'sent',
    },
  };

  return jsonResponse({ success: true, data });
}

/**
 * POST /api/conversations/:conversationId/toggle-bot
 * Toggle bot for a conversation
 */
async function handleToggleBot(req: Request, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/conversations\/([^/]+)\/toggle-bot$/);
  if (!match || req.method !== 'POST') {
    return null;
  }

  const conversationId = match[1];
  const body: any = await req.json();

  const tenant = await getTenantAndRestaurantId(url);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  if (typeof body.enabled !== 'boolean') {
    return jsonResponse({ success: false, error: 'enabled field is required and must be boolean' }, 400);
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      restaurantId: tenant.restaurantId,
    },
  });

  if (!conversation) {
    return jsonResponse({ success: false, error: 'Conversation not found' }, 404);
  }

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      isBotActive: body.enabled,
      updatedAt: new Date(),
    },
  });

  const data = {
    conversation: {
      id: updated.id,
      is_bot_active: updated.isBotActive,
      updated_at: updated.updatedAt.toISOString(),
    },
  };

  return jsonResponse({ success: true, data });
}

/**
 * Export all handlers
 */
export async function handleDashboardApi(req: Request, url: URL): Promise<Response | null> {
  // Dashboard Overview
  const overviewResponse = await handleDashboardOverview(req, url);
  if (overviewResponse) return overviewResponse;

  // Orders endpoints
  const ordersStatsResponse = await handleOrdersStats(req, url);
  if (ordersStatsResponse) return ordersStatsResponse;

  const ordersListResponse = await handleOrdersList(req, url);
  if (ordersListResponse) return ordersListResponse;

  const orderStatusUpdateResponse = await handleOrderStatusUpdate(req, url);
  if (orderStatusUpdateResponse) return orderStatusUpdateResponse;

  // Conversations endpoints
  const conversationsListResponse = await handleConversationsList(req, url);
  if (conversationsListResponse) return conversationsListResponse;

  const conversationMessagesResponse = await handleConversationMessages(req, url);
  if (conversationMessagesResponse) return conversationMessagesResponse;

  const sendMessageResponse = await handleSendMessage(req, url);
  if (sendMessageResponse) return sendMessageResponse;

  const toggleBotResponse = await handleToggleBot(req, url);
  if (toggleBotResponse) return toggleBotResponse;

  return null;
}

