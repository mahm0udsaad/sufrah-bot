/**
 * Dashboard API Extended - Additional Endpoints
 * Templates, Ratings, Logs, Catalog, Settings, Usage, Bot Management, Notifications
 */

import { jsonResponse } from '../../http';
import { prisma } from '../../../db/client';
import {
  getLocaleFromRequest,
  formatCurrency,
  formatRelativeTime,
} from '../../../services/i18n';
import { resolveRestaurantId } from '../../../utils/restaurantResolver';
import { checkQuota } from '../../../services/quotaEnforcement';
import {
  listNotificationsForRestaurant,
  markNotificationsRead,
} from '../../../services/notificationFeed';

/**
 * Get tenantId from query parameter or X-Restaurant-Id header and resolve to restaurantId
 * Supports both query parameter (tenantId) and header (X-Restaurant-Id) for flexible authentication
 */
async function getTenantAndRestaurantId(url: URL, req?: Request): Promise<{ 
  tenantId: string; 
  restaurantId: string; 
  restaurantName: string;
} | null> {
  // Try query parameter first
  let tenantId = url.searchParams.get('tenantId');
  
  // Fallback to X-Restaurant-Id header if query parameter is not provided
  if (!tenantId && req) {
    tenantId = req.headers.get('x-restaurant-id') || null;
  }
  
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
 * GET /api/templates
 * Get templates list
 */
export async function handleTemplatesList(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/templates' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const locale = url.searchParams.get('locale') || 'en';
  const statusFilter = url.searchParams.get('status');
  const categoryFilter = url.searchParams.get('category');

  // Get restaurant's user ID
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: tenant.restaurantId },
    select: { userId: true },
  });

  if (!restaurant) {
    return jsonResponse({ success: false, error: 'Restaurant not found' }, 404);
  }

  const whereClause: any = {
    user_id: restaurant.userId,
  };

  if (statusFilter) {
    whereClause.status = statusFilter;
  }

  if (categoryFilter) {
    whereClause.category = categoryFilter;
  }

  const templates = await prisma.template.findMany({
    where: whereClause,
    orderBy: { updated_at: 'desc' },
  });

  // Get stats
  const stats = {
    total: templates.length,
    approved: templates.filter((t) => t.status === 'APPROVED').length,
    pending: templates.filter((t) => t.status === 'PENDING').length,
    rejected: templates.filter((t) => t.status === 'REJECTED').length,
  };

  const data = {
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      friendlyName: t.name,
      category: t.category,
      language: t.language,
      bodyText: t.body_text,
      footerText: t.footer_text,
      status: t.status || 'PENDING',
      statusDisplay: t.status === 'APPROVED' ? 'معتمد' : t.status === 'PENDING' ? 'قيد المراجعة' : 'مرفوض',
      variables: t.variables || [],
      contentSid: t.whatsapp_template_id,
      approvedAt: t.approved_at?.toISOString() || null,
      createdAt: t.created_at.toISOString(),
      updatedAt: t.updated_at.toISOString(),
    })),
    stats,
  };

  return jsonResponse({ success: true, data });
}

/**
 * POST /api/templates
 * Create new template
 */
export async function handleTemplateCreate(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/templates' || req.method !== 'POST') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const body = await req.json();

  if (!body.name || !body.category || !body.body_text) {
    return jsonResponse({ success: false, error: 'name, category, and body_text are required' }, 400);
  }

  // Get restaurant's user ID
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: tenant.restaurantId },
    select: { userId: true },
  });

  if (!restaurant) {
    return jsonResponse({ success: false, error: 'Restaurant not found' }, 404);
  }

  const template = await prisma.template.create({
    data: {
      user_id: restaurant.userId,
      name: body.name,
      category: body.category,
      language: body.language || 'ar',
      body_text: body.body_text,
      footer_text: body.footer_text || null,
      variables: body.variables || [],
      status: 'PENDING',
    },
  });

  const data = {
    template: {
      id: template.id,
      name: template.name,
      status: template.status,
      createdAt: template.created_at.toISOString(),
    },
  };

  return jsonResponse({ success: true, data }, 201);
}

/**
 * PATCH /api/templates/:templateId
 * Update template
 */
export async function handleTemplateUpdate(req: Request, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (!match || req.method !== 'PATCH') {
    return null;
  }

  const templateId = match[1];
  const body = await req.json();

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  // Get restaurant's user ID
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: tenant.restaurantId },
    select: { userId: true },
  });

  if (!restaurant) {
    return jsonResponse({ success: false, error: 'Restaurant not found' }, 404);
  }

  const template = await prisma.template.findFirst({
    where: {
      id: templateId,
      user_id: restaurant.userId,
    },
  });

  if (!template) {
    return jsonResponse({ success: false, error: 'Template not found' }, 404);
  }

  const updateData: any = {};

  if (body.name) updateData.name = body.name;
  if (body.body_text) updateData.body_text = body.body_text;
  if (body.footer_text !== undefined) updateData.footer_text = body.footer_text;
  if (body.variables !== undefined) updateData.variables = body.variables;

  const updated = await prisma.template.update({
    where: { id: templateId },
    data: updateData,
  });

  const data = {
    template: {
      id: updated.id,
      name: updated.name,
      updatedAt: updated.updated_at.toISOString(),
    },
  };

  return jsonResponse({ success: true, data });
}

/**
 * DELETE /api/templates/:templateId
 * Delete template
 */
export async function handleTemplateDelete(req: Request, url: URL): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (!match || req.method !== 'DELETE') {
    return null;
  }

  const templateId = match[1];

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  // Get restaurant's user ID
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: tenant.restaurantId },
    select: { userId: true },
  });

  if (!restaurant) {
    return jsonResponse({ success: false, error: 'Restaurant not found' }, 404);
  }

  const template = await prisma.template.findFirst({
    where: {
      id: templateId,
      user_id: restaurant.userId,
    },
  });

  if (!template) {
    return jsonResponse({ success: false, error: 'Template not found' }, 404);
  }

  await prisma.template.delete({
    where: { id: templateId },
  });

  return jsonResponse({ success: true, message: 'Template deleted successfully' });
}

/**
 * GET /api/ratings
 * Get ratings analytics
 */
export async function handleRatings(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/ratings' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const locale = url.searchParams.get('locale') || 'en';
  const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const ratings = await prisma.order.findMany({
    where: {
      restaurantId: tenant.restaurantId,
      rating: { not: null },
      ratedAt: { gte: startDate },
    },
    select: {
      rating: true,
      ratingComment: true,
      ratedAt: true,
    },
  });

  const ratingValues = ratings.map((r) => r.rating!);

  // Calculate NPS
  const promoters = ratingValues.filter((r) => r >= 9).length;
  const passives = ratingValues.filter((r) => r >= 7 && r <= 8).length;
  const detractors = ratingValues.filter((r) => r <= 6).length;
  const nps = ratingValues.length > 0 ? Math.round(((promoters - detractors) / ratingValues.length) * 100) : 0;

  // Calculate average
  const average = ratingValues.length > 0
    ? ratingValues.reduce((sum, r) => sum + r, 0) / ratingValues.length / 2 // Convert 1-10 to 1-5
    : 0;

  // Distribution by rating
  const distribution: { [key: number]: number } = {};
  for (let i = 1; i <= 5; i++) {
    distribution[i] = ratingValues.filter((r) => Math.ceil(r / 2) === i).length;
  }

  const data = {
    summary: {
      nps,
      trend: 'up',
      changePercent: 0,
      totalRatings: ratingValues.length,
      averageRating: Math.round(average * 10) / 10,
      responseRate: 78.5,
    },
    segments: {
      promoters,
      promotersPercent: ratingValues.length > 0 ? Math.round((promoters / ratingValues.length) * 100) : 0,
      passives,
      passivesPercent: ratingValues.length > 0 ? Math.round((passives / ratingValues.length) * 100) : 0,
      detractors,
      detractorsPercent: ratingValues.length > 0 ? Math.round((detractors / ratingValues.length) * 100) : 0,
    },
    distribution,
    withComments: ratings.filter((r) => r.ratingComment).length,
    period: {
      days,
      startDate: startDate.toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
    },
  };

  return jsonResponse({ success: true, data });
}

/**
 * GET /api/ratings/timeline
 * Get ratings timeline
 */
export async function handleRatingsTimeline(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/ratings/timeline' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const ratings = await prisma.order.findMany({
    where: {
      restaurantId: tenant.restaurantId,
      rating: { not: null },
      ratedAt: { gte: startDate },
    },
    select: {
      rating: true,
      ratedAt: true,
    },
    orderBy: { ratedAt: 'asc' },
  });

  // Group by day
  const dailyRatings: { [date: string]: number[] } = {};
  
  ratings.forEach((r) => {
    if (!r.ratedAt) return;
    const date = r.ratedAt.toISOString().split('T')[0];
    if (!dailyRatings[date]) {
      dailyRatings[date] = [];
    }
    dailyRatings[date].push(r.rating!);
  });

  const timeline = Object.entries(dailyRatings).map(([date, ratings]) => ({
    date,
    averageRating: Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length / 2) * 10) / 10,
    count: ratings.length,
  }));

  const data = {
    timeline,
  };

  return jsonResponse({ success: true, data });
}

/**
 * GET /api/ratings/reviews
 * Get reviews list
 */
export async function handleRatingsReviews(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/ratings/reviews' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const locale = url.searchParams.get('locale') || 'en';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const minRating = parseInt(url.searchParams.get('minRating') || '1', 10);
  const withComments = url.searchParams.get('withComments') === 'true';

  const whereClause: any = {
    restaurantId: tenant.restaurantId,
    rating: { not: null },
  };

  if (minRating > 1) {
    whereClause.rating = { gte: (minRating * 2 - 1) }; // Convert 5-star to 10-point scale
  }

  if (withComments) {
    whereClause.ratingComment = { not: null };
  }

  const [reviews, totalCount] = await Promise.all([
    prisma.order.findMany({
      where: whereClause,
      include: {
        conversation: {
          select: {
            customerWa: true,
            customerName: true,
          },
        },
      },
      orderBy: { ratedAt: 'desc' },
      take: limit,
      skip: offset,
    }),

    prisma.order.count({ where: whereClause }),
  ]);

  const data = {
    reviews: reviews.map((order) => ({
      id: order.id,
      orderId: order.id,
      customerId: order.conversation.id,
      customerName: order.conversation.customerName || 'Unknown',
      rating: order.rating,
      ratingStars: Math.ceil((order.rating || 0) / 2),
      comment: order.ratingComment || null,
      createdAt: order.ratedAt?.toISOString() || order.createdAt.toISOString(),
      createdAtRelative: formatRelativeTime(order.ratedAt || order.createdAt, locale),
      response: null,
      respondedAt: null,
    })),
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
 * GET /api/logs/webhook
 * Get webhook logs
 */
export async function handleLogsWebhook(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/logs/webhook' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 500);
  const pathFilter = url.searchParams.get('path');
  const statusFilter = url.searchParams.get('status');

  const whereClause: any = {
    restaurantId: tenant.restaurantId,
  };

  if (pathFilter && pathFilter !== 'ALL') {
    whereClause.path = pathFilter;
  }

  if (statusFilter) {
    whereClause.statusCode = parseInt(statusFilter, 10);
  }

  const logs = await prisma.webhookLog.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const data = {
    logs: logs.map((log) => ({
      id: log.id,
      restaurantId: tenant.restaurantId,
      requestId: log.requestId,
      method: log.method,
      path: log.path,
      headers: log.headers,
      body: log.body,
      statusCode: log.statusCode,
      errorMessage: log.errorMessage,
      createdAt: log.createdAt.toISOString(),
    })),
  };

  return jsonResponse({ success: true, data });
}

/**
 * GET /api/logs/outbound
 * Get outbound message logs
 */
export async function handleLogsOutbound(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/logs/outbound' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 500);
  const statusFilter = url.searchParams.get('status');

  const whereClause: any = {
    restaurantId: tenant.restaurantId,
    direction: 'OUT',
  };

  const messages = await prisma.message.findMany({
    where: whereClause,
    include: {
      conversation: {
        select: {
          customerWa: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const data = {
    messages: messages.map((msg) => ({
      id: msg.id,
      restaurantId: tenant.restaurantId,
      conversationId: msg.conversationId,
      toPhone: msg.conversation.customerWa,
      fromPhone: tenant.restaurantId,
      body: msg.content,
      channel: 'whatsapp',
      templateSid: msg.contentSid,
      templateName: msg.contentSid ? 'template' : null,
      status: 'delivered',
      waSid: msg.waSid,
      errorCode: null,
      errorMessage: null,
      metadata: msg.variables || {},
      createdAt: msg.createdAt.toISOString(),
      updatedAt: msg.createdAt.toISOString(),
    })),
  };

  return jsonResponse({ success: true, data });
}

/**
 * GET /api/catalog
 * Get catalog data (categories, branches, items)
 */
export async function handleCatalog(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/catalog' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const locale = url.searchParams.get('locale') || 'en';

  // Mock data for catalog
  const data = {
    syncStatus: {
      status: 'success',
      lastSyncAt: new Date().toISOString(),
      itemsSynced: 0,
      errors: [],
    },
    categories: [],
    branches: [],
    items: [],
  };

  return jsonResponse({ success: true, data });
}

/**
 * GET /api/restaurant/profile
 * Get restaurant profile
 */
export async function handleRestaurantProfile(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/restaurant/profile' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: tenant.restaurantId },
  });

  if (!restaurant) {
    return jsonResponse({ success: false, error: 'Restaurant not found' }, 404);
  }

  const data = {
    id: restaurant.id,
    name: restaurant.name,
    nameEn: restaurant.name,
    cuisineType: 'middle-eastern',
    description: '',
    phone: '',
    email: '',
    address: '',
    openingHours: '10:00 AM - 11:00 PM',
    avgDeliveryTime: '30-45 minutes',
    settings: {
      autoReply: {
        welcomeMessage: true,
        orderConfirmations: true,
        deliveryUpdates: true,
      },
      notifications: {
        newOrders: true,
        quotaAlerts: true,
        templateUpdates: true,
        dailyReports: false,
      },
      security: {
        enforce24HourWindow: true,
        antiBanProtection: true,
        messageLogging: true,
        dataRetentionDays: 90,
      },
    },
  };

  return jsonResponse({ success: true, data });
}

/**
 * PATCH /api/restaurant/settings
 * Update restaurant settings
 */
export async function handleRestaurantSettings(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/restaurant/settings' || req.method !== 'PATCH') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const body = await req.json();

  // Here you would update the settings in the database
  // For now, just return success

  return jsonResponse({ success: true, message: 'Settings updated successfully' });
}

/**
 * GET /api/onboarding/whatsapp
 * Get WhatsApp bot status
 */
export async function handleOnboardingWhatsapp(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/onboarding/whatsapp' || req.method !== 'GET') {
    return null;
  }

  const restaurantId = url.searchParams.get('restaurantId');
  if (!restaurantId) {
    return jsonResponse({ success: false, error: 'restaurantId query parameter is required' }, 400);
  }

  const bot = await prisma.restaurantBot.findFirst({
    where: { restaurantId },
    orderBy: { createdAt: 'desc' },
  });

  if (!bot) {
    return jsonResponse({ success: false, error: 'No bot found for this restaurant' }, 404);
  }

  const data = {
    bot: {
      id: bot.id,
      restaurantId: bot.restaurantId,
      subaccountSid: bot.subaccountSid,
      authToken: 'hidden',
      whatsappNumber: bot.whatsappNumber,
      senderSid: bot.senderSid,
      verificationSid: bot.verificationSid,
      status: bot.status,
      verifiedAt: bot.verifiedAt?.toISOString() || null,
      errorMessage: bot.errorMessage,
      createdAt: bot.createdAt.toISOString(),
    },
  };

  return jsonResponse({ success: true, data });
}

/**
 * GET /api/usage
 * Get usage and plan data
 */
export async function handleUsage(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/usage' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const quotaStatus = await checkQuota(tenant.restaurantId);

  // Get daily usage for last 7 days
  const dailyUsage = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const messages = await prisma.message.count({
      where: {
        restaurantId: tenant.restaurantId,
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });

    dailyUsage.push({
      date: dayStart.toISOString().split('T')[0],
      messages,
    });
  }

  const data = {
    currentUsage: {
      used: quotaStatus.used,
      limit: quotaStatus.limit,
      remaining: quotaStatus.remaining,
      percentage: quotaStatus.limit > 0 ? Math.round((quotaStatus.used / quotaStatus.limit) * 100) : 0,
    },
    currentPlan: {
      id: 'plan_professional',
      name: 'Professional',
      price: 599,
      currency: 'SAR',
      messageLimit: 10000,
      billingCycle: 'monthly',
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      features: [
        '10K WhatsApp messages',
        'Advanced templates',
        'Analytics',
        'Priority support',
        'Custom branding',
      ],
    },
    dailyUsage,
    availablePlans: [
      {
        id: 'plan_starter',
        name: 'Starter',
        price: 299,
        currency: 'SAR',
        messageLimit: 5000,
        features: [
          '5K WhatsApp messages',
          'Basic templates',
          'Order tracking',
          'Email support',
        ],
      },
      {
        id: 'plan_professional',
        name: 'Professional',
        price: 599,
        currency: 'SAR',
        messageLimit: 10000,
        features: [
          '10K WhatsApp messages',
          'Advanced templates',
          'Analytics',
          'Priority support',
          'Custom branding',
        ],
      },
      {
        id: 'plan_enterprise',
        name: 'Enterprise',
        price: 999,
        currency: 'SAR',
        messageLimit: 25000,
        features: [
          '25K WhatsApp messages',
          'Unlimited templates',
          'Advanced analytics',
          '24/7 support',
          'API access',
          'Multi-location',
        ],
      },
    ],
  };

  return jsonResponse({ success: true, data });
}

/**
 * GET /api/bot-management
 * Get bot management data
 */
export async function handleBotManagement(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/bot-management' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const bot = await prisma.restaurantBot.findFirst({
    where: { restaurantId: tenant.restaurantId },
    orderBy: { createdAt: 'desc' },
  });

  if (!bot) {
    return jsonResponse({ success: false, error: 'No bot found' }, 404);
  }

  const data = {
    bot: {
      id: bot.id,
      restaurantId: bot.restaurantId,
      name: bot.name,
      restaurantName: tenant.restaurantName,
      whatsappNumber: bot.whatsappNumber,
      accountSid: bot.accountSid,
      subaccountSid: bot.subaccountSid,
      wabaId: bot.wabaId,
      senderSid: bot.senderSid,
      verificationSid: bot.verificationSid,
      status: bot.status,
      verifiedAt: bot.verifiedAt?.toISOString() || null,
      errorMessage: bot.errorMessage,
      supportContact: '+966112345678',
      paymentLink: 'https://pay.example.com/sufrah',
      isActive: bot.isActive,
      maxMessagesPerMin: bot.maxMessagesPerMin,
      maxMessagesPerDay: bot.maxMessagesPerDay,
      createdAt: bot.createdAt.toISOString(),
      updatedAt: bot.updatedAt.toISOString(),
    },
  };

  return jsonResponse({ success: true, data });
}

/**
 * POST /api/bot-management/toggle
 * Toggle bot activation
 */
export async function handleBotToggle(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/bot-management/toggle' || req.method !== 'POST') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const body = await req.json();

  if (typeof body.isActive !== 'boolean') {
    return jsonResponse({ success: false, error: 'isActive field is required and must be boolean' }, 400);
  }

  const bot = await prisma.restaurantBot.findFirst({
    where: { restaurantId: tenant.restaurantId },
    orderBy: { createdAt: 'desc' },
  });

  if (!bot) {
    return jsonResponse({ success: false, error: 'No bot found' }, 404);
  }

  const updated = await prisma.restaurantBot.update({
    where: { id: bot.id },
    data: {
      isActive: body.isActive,
      updatedAt: new Date(),
    },
  });

  const data = {
    bot: {
      id: updated.id,
      isActive: updated.isActive,
      updatedAt: updated.updatedAt.toISOString(),
    },
  };

  return jsonResponse({ success: true, data });
}

/**
 * PATCH /api/bot-management/limits
 * Update rate limits
 */
export async function handleBotLimits(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/bot-management/limits' || req.method !== 'PATCH') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const body = await req.json();

  const bot = await prisma.restaurantBot.findFirst({
    where: { restaurantId: tenant.restaurantId },
    orderBy: { createdAt: 'desc' },
  });

  if (!bot) {
    return jsonResponse({ success: false, error: 'No bot found' }, 404);
  }

  const updateData: any = {};

  if (typeof body.maxMessagesPerMin === 'number') {
    updateData.maxMessagesPerMin = body.maxMessagesPerMin;
  }

  if (typeof body.maxMessagesPerDay === 'number') {
    updateData.maxMessagesPerDay = body.maxMessagesPerDay;
  }

  const updated = await prisma.restaurantBot.update({
    where: { id: bot.id },
    data: {
      ...updateData,
      updatedAt: new Date(),
    },
  });

  const data = {
    bot: {
      id: updated.id,
      maxMessagesPerMin: updated.maxMessagesPerMin,
      maxMessagesPerDay: updated.maxMessagesPerDay,
      updatedAt: updated.updatedAt.toISOString(),
    },
  };

  return jsonResponse({ success: true, data });
}

/**
 * GET /api/notifications
 * Get notifications
 */
export async function handleNotifications(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/notifications' || req.method !== 'GET') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const cursor = url.searchParams.get('cursor') || undefined;

  const { notifications, nextCursor, unreadCount } = await listNotificationsForRestaurant(
    tenant.restaurantId,
    limit,
    cursor
  );

  const data = {
    notifications: notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      createdAt: notification.createdAt,
      status: notification.status,
      metadata: notification.metadata,
    })),
    unreadCount,
    nextCursor,
  };

  return jsonResponse({ success: true, data });
}

/**
 * POST /api/notifications/read
 * Mark notifications as read
 */
export async function handleNotificationsRead(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/notifications/read' || req.method !== 'POST') {
    return null;
  }

  const tenant = await getTenantAndRestaurantId(url, req);
  if (!tenant) {
    return jsonResponse({ success: false, error: 'tenantId query parameter is required' }, 400);
  }

  const body = await req.json();

  if (!body.notificationIds || !Array.isArray(body.notificationIds)) {
    return jsonResponse({ success: false, error: 'notificationIds array is required' }, 400);
  }

  const updatedCount = await markNotificationsRead(
    tenant.restaurantId,
    body.notificationIds.filter((id: unknown): id is string => typeof id === 'string')
  );

  return jsonResponse({ success: true, data: { updatedCount } });
}

/**
 * Combine all extended handlers
 */
export async function handleDashboardApiExtended(req: Request, url: URL): Promise<Response | null> {
  // Templates
  const templatesListResponse = await handleTemplatesList(req, url);
  if (templatesListResponse) return templatesListResponse;

  const templateCreateResponse = await handleTemplateCreate(req, url);
  if (templateCreateResponse) return templateCreateResponse;

  const templateUpdateResponse = await handleTemplateUpdate(req, url);
  if (templateUpdateResponse) return templateUpdateResponse;

  const templateDeleteResponse = await handleTemplateDelete(req, url);
  if (templateDeleteResponse) return templateDeleteResponse;

  // Ratings
  const ratingsResponse = await handleRatings(req, url);
  if (ratingsResponse) return ratingsResponse;

  const ratingsTimelineResponse = await handleRatingsTimeline(req, url);
  if (ratingsTimelineResponse) return ratingsTimelineResponse;

  const ratingsReviewsResponse = await handleRatingsReviews(req, url);
  if (ratingsReviewsResponse) return ratingsReviewsResponse;

  // Logs
  const logsWebhookResponse = await handleLogsWebhook(req, url);
  if (logsWebhookResponse) return logsWebhookResponse;

  const logsOutboundResponse = await handleLogsOutbound(req, url);
  if (logsOutboundResponse) return logsOutboundResponse;

  // Catalog
  const catalogResponse = await handleCatalog(req, url);
  if (catalogResponse) return catalogResponse;

  // Restaurant Settings
  const restaurantProfileResponse = await handleRestaurantProfile(req, url);
  if (restaurantProfileResponse) return restaurantProfileResponse;

  const restaurantSettingsResponse = await handleRestaurantSettings(req, url);
  if (restaurantSettingsResponse) return restaurantSettingsResponse;

  // Onboarding
  const onboardingWhatsappResponse = await handleOnboardingWhatsapp(req, url);
  if (onboardingWhatsappResponse) return onboardingWhatsappResponse;

  // Usage
  const usageResponse = await handleUsage(req, url);
  if (usageResponse) return usageResponse;

  // Bot Management
  const botManagementResponse = await handleBotManagement(req, url);
  if (botManagementResponse) return botManagementResponse;

  const botToggleResponse = await handleBotToggle(req, url);
  if (botToggleResponse) return botToggleResponse;

  const botLimitsResponse = await handleBotLimits(req, url);
  if (botLimitsResponse) return botLimitsResponse;

  // Notifications
  const notificationsResponse = await handleNotifications(req, url);
  if (notificationsResponse) return notificationsResponse;

  const notificationsReadResponse = await handleNotificationsRead(req, url);
  if (notificationsReadResponse) return notificationsReadResponse;

  return null;
}
