/**
 * Orders API for dashboard
 * Provides real-time order feed with SLA tracking and management
 */

import { jsonResponse } from '../../http';
import { DASHBOARD_PAT, BOT_API_KEY } from '../../../config';
import { prisma } from '../../../db/client';
import { getOrderFeed } from '../../../services/dashboardMetrics';
import {
  getLocaleFromRequest,
  createLocalizedResponse,
  t,
  formatCurrency,
  formatRelativeTime,
  getOrderStatusDisplay,
  getOrderTypeDisplay,
  getPaymentMethodDisplay,
  getOrderAlertMessages,
  getCustomerDisplayName,
} from '../../../services/i18n';

type AuthResult = { ok: boolean; restaurantId?: string; isAdmin?: boolean; error?: string };

function authenticate(req: Request): AuthResult {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';

  let token = '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearer && bearer[1]) token = bearer[1].trim();

  if (DASHBOARD_PAT && token && token === DASHBOARD_PAT) {
    const restaurantId = (req.headers.get('x-restaurant-id') || '').trim();
    if (!restaurantId) {
      return { ok: false, error: 'X-Restaurant-Id header is required' };
    }
    return { ok: true, restaurantId };
  }

  if (BOT_API_KEY && apiKeyHeader && apiKeyHeader === BOT_API_KEY) {
    return { ok: true, isAdmin: true };
  }

  return { ok: false, error: 'Unauthorized' };
}

/**
 * Handle GET /api/orders/live
 * Returns real-time order feed with alerts and SLA tracking
 */
export async function handleOrdersApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/orders/live
  if (url.pathname === '/api/orders/live' && req.method === 'GET') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const status = url.searchParams.get('status');

    const orderFeed = await getOrderFeed(auth.restaurantId, limit, offset);

    // Add localized data
    const localizedOrders = orderFeed.orders.map((order) => {
      const alertMessages = getOrderAlertMessages(order.alerts, locale);

      return {
        ...order,
        customerName: getCustomerDisplayName(order.customerName, locale),
        statusDisplay: getOrderStatusDisplay(order.status, locale),
        totalFormatted: formatCurrency(order.totalCents, (order.currency as any) || 'SAR', locale),
        createdAtRelative: formatRelativeTime(order.createdAt, locale),
        orderTypeDisplay: getOrderTypeDisplay(order.orderType, locale),
        paymentMethodDisplay: getPaymentMethodDisplay(order.paymentMethod, locale),
        alerts: {
          ...order.alerts,
          messages: alertMessages,
        },
        alertMessages,
      };
    });

    return jsonResponse(
      createLocalizedResponse(
        {
          ...orderFeed,
          orders: localizedOrders,
        },
        locale
      )
    );
  }

  // GET /api/orders/:id
  const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && req.method === 'GET') {
    const orderId = orderMatch[1];
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        restaurantId: auth.restaurantId,
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
    });

    if (!order) {
      return jsonResponse(createLocalizedResponse({ error: t('order.error.not_found', locale) }, locale), 404);
    }

    const response = {
      id: order.id,
      orderReference: order.orderReference,
      status: order.status,
      statusDisplay: getOrderStatusDisplay(order.status, locale),
      statusStage: order.statusStage,
      customer: {
        name: getCustomerDisplayName(order.conversation.customerName, locale),
        phone: order.conversation.customerWa,
      },
      items: order.items.map((item) => ({
        ...item,
        unitFormatted: formatCurrency(item.unitCents, (order.currency as any) || 'SAR', locale),
        totalFormatted: formatCurrency(item.totalCents, (order.currency as any) || 'SAR', locale),
      })),
      totalCents: order.totalCents,
      totalFormatted: formatCurrency(order.totalCents, (order.currency as any) || 'SAR', locale),
      currency: order.currency,
      orderType: order.orderType,
      orderTypeDisplay: getOrderTypeDisplay(order.orderType, locale),
      paymentMethod: order.paymentMethod,
      paymentMethodDisplay: getPaymentMethodDisplay(order.paymentMethod, locale),
      deliveryAddress: order.deliveryAddress,
      branchName: order.branchName,
      branchAddress: order.branchAddress,
      rating: order.rating,
      ratingComment: order.ratingComment,
      ratedAt: order.ratedAt?.toISOString() || null,
      createdAt: order.createdAt.toISOString(),
      createdAtRelative: formatRelativeTime(order.createdAt, locale),
      updatedAt: order.updatedAt.toISOString(),
    };

    return jsonResponse(createLocalizedResponse(response, locale));
  }

  // PATCH /api/orders/:id - update order status
  if (orderMatch && req.method === 'PATCH') {
    const orderId = orderMatch[1];
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = await req.json();
    const locale = getLocaleFromRequest(req);

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        restaurantId: auth.restaurantId,
      },
    });

    if (!order) {
      return jsonResponse(createLocalizedResponse({ error: t('order.error.not_found', locale) }, locale), 404);
    }

    const updateData: any = {};

    if (body.status && ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'].includes(body.status)) {
      updateData.status = body.status;
      
      // Update status stage based on status
      const statusMap: { [key: string]: number } = {
        CONFIRMED: 1,
        PREPARING: 2,
        OUT_FOR_DELIVERY: 3,
        DELIVERED: 4,
        CANCELLED: -1,
      };
      updateData.statusStage = statusMap[body.status] || 0;
    }

    if (body.meta) {
      updateData.meta = body.meta;
    }

    if (Object.keys(updateData).length === 0) {
      return jsonResponse(createLocalizedResponse({ error: t('order.error.no_changes', locale) }, locale), 400);
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: updateData,
    });

    return jsonResponse(
      createLocalizedResponse(
        {
          orderId: updated.id,
          updated: true,
          changes: updateData,
          newStatus: updated.status,
          newStatusDisplay: getOrderStatusDisplay(updated.status, locale),
        },
        locale
      )
    );
  }

  // GET /api/orders/stats - order statistics
  if (url.pathname === '/api/orders/stats' && req.method === 'GET') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totalOrders, totalRevenue, avgPrepTime, ordersByStatus] = await Promise.all([
      prisma.order.count({
        where: {
          restaurantId: auth.restaurantId,
          status: { not: 'DRAFT' },
          createdAt: { gte: startDate },
        },
      }),

      prisma.order.aggregate({
        where: {
          restaurantId: auth.restaurantId,
          status: { in: ['DELIVERED'] },
          createdAt: { gte: startDate },
        },
        _sum: { totalCents: true },
      }),

      prisma.$queryRaw<Array<{ avg_prep_time: number }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 60) as avg_prep_time
        FROM "Order"
        WHERE restaurant_id = ${auth.restaurantId}
          AND status IN ('DELIVERED')
          AND created_at >= ${startDate}
      `,

      prisma.order.groupBy({
        by: ['status'],
        where: {
          restaurantId: auth.restaurantId,
          status: { not: 'DRAFT' },
          createdAt: { gte: startDate },
        },
        _count: true,
      }),
    ]);

    const stats = {
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      totalOrders,
      totalRevenueCents: totalRevenue._sum.totalCents || 0,
      totalRevenueFormatted: formatCurrency(totalRevenue._sum.totalCents || 0, 'SAR', locale),
      avgPrepTimeMinutes: Math.round(avgPrepTime[0]?.avg_prep_time || 0),
      ordersByStatus: ordersByStatus.map((item) => ({
        status: item.status,
        statusDisplay: getOrderStatusDisplay(item.status, locale),
        count: item._count,
      })),
    };

    return jsonResponse(createLocalizedResponse(stats, locale));
  }

  return null;
}
