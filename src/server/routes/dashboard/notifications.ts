/**
 * Notifications API for dashboard
 * Provides real-time notification feed for owner alerts
 */

import { jsonResponse } from '../../http';
import { prisma } from '../../../db/client';
import { getLocaleFromRequest, createLocalizedResponse, formatRelativeTime } from '../../../services/i18n';
import { authenticateDashboard } from '../../../utils/dashboardAuth';



interface NotificationEvent {
  id: string;
  type: 'new_order' | 'failed_send' | 'quota_warning' | 'template_expiring' | 'sla_breach' | 'webhook_error';
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  data?: any;
  read: boolean;
  createdAt: string;
}

/**
 * Generate notifications from recent activity
 * In a production system, these would be persisted in a notifications table
 */
async function generateNotifications(restaurantId: string): Promise<NotificationEvent[]> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const notifications: NotificationEvent[] = [];

  // Check for new orders in last hour
  const newOrders = await prisma.order.count({
    where: {
      restaurantId,
      status: 'CONFIRMED',
      createdAt: { gte: oneHourAgo },
    },
  });

  if (newOrders > 0) {
    notifications.push({
      id: `new-orders-${Date.now()}`,
      type: 'new_order',
      severity: 'info',
      title: 'New Orders',
      message: `You have ${newOrders} new order${newOrders > 1 ? 's' : ''} awaiting confirmation`,
      data: { count: newOrders },
      read: false,
      createdAt: new Date().toISOString(),
    });
  }

  // Check for failed sends
  const failedSends = await prisma.outboundMessage.count({
    where: {
      restaurantId,
      status: 'failed',
      createdAt: { gte: oneHourAgo },
    },
  });

  if (failedSends > 0) {
    notifications.push({
      id: `failed-sends-${Date.now()}`,
      type: 'failed_send',
      severity: 'error',
      title: 'Failed Messages',
      message: `${failedSends} message${failedSends > 1 ? 's' : ''} failed to send in the last hour`,
      data: { count: failedSends },
      read: false,
      createdAt: new Date().toISOString(),
    });
  }

  // Check for SLA breaches (conversations unattended for >15 mins)
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const slaBreaches = await prisma.conversation.count({
    where: {
      restaurantId,
      status: 'active',
      lastMessageAt: { lt: fifteenMinutesAgo },
      unreadCount: { gt: 0 },
    },
  });

  if (slaBreaches > 0) {
    notifications.push({
      id: `sla-breach-${Date.now()}`,
      type: 'sla_breach',
      severity: 'warning',
      title: 'SLA Breaches',
      message: `${slaBreaches} conversation${slaBreaches > 1 ? 's' : ''} need attention (>15 min wait)`,
      data: { count: slaBreaches },
      read: false,
      createdAt: new Date().toISOString(),
    });
  }

  // Check for webhook errors
  const webhookErrors = await prisma.webhookLog.count({
    where: {
      restaurantId,
      statusCode: { gte: 500 },
      createdAt: { gte: oneHourAgo },
    },
  });

  if (webhookErrors > 0) {
    notifications.push({
      id: `webhook-errors-${Date.now()}`,
      type: 'webhook_error',
      severity: 'error',
      title: 'Webhook Errors',
      message: `${webhookErrors} webhook error${webhookErrors > 1 ? 's' : ''} occurred in the last hour`,
      data: { count: webhookErrors },
      read: false,
      createdAt: new Date().toISOString(),
    });
  }

  // Check quota usage (warning if >80%)
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  
  const usage = await prisma.monthlyUsage.findUnique({
    where: {
      restaurantId_month_year: {
        restaurantId,
        month: currentMonth,
        year: currentYear,
      },
    },
  });

  const bot = await prisma.restaurantBot.findFirst({
    where: { restaurantId, isActive: true },
  });

  const monthlyLimit = bot?.maxMessagesPerDay ? bot.maxMessagesPerDay * 30 : 30000; // Rough estimate
  const usagePercent = usage ? (usage.conversationCount / monthlyLimit) * 100 : 0;

  if (usagePercent > 80) {
    notifications.push({
      id: `quota-warning-${Date.now()}`,
      type: 'quota_warning',
      severity: usagePercent > 95 ? 'error' : 'warning',
      title: 'Quota Warning',
      message: `You've used ${Math.round(usagePercent)}% of your monthly quota`,
      data: { usagePercent: Math.round(usagePercent), remaining: monthlyLimit - (usage?.conversationCount || 0) },
      read: false,
      createdAt: new Date().toISOString(),
    });
  }

  return notifications;
}

/**
 * Handle GET /api/notifications
 * Returns notification feed for the restaurant
 */
export async function handleNotificationsApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/notifications
  if (url.pathname === '/api/notifications' && req.method === 'GET') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const includeRead = url.searchParams.get('include_read') === 'true';

    const notifications = await generateNotifications(auth.restaurantId);

    // Filter out read notifications if requested
    const filteredNotifications = includeRead 
      ? notifications 
      : notifications.filter((n) => !n.read);

    // Add relative time
    const enhancedNotifications = filteredNotifications.map((notif) => ({
      ...notif,
      createdAtRelative: formatRelativeTime(notif.createdAt, locale),
    }));

    return jsonResponse(
      createLocalizedResponse(
        {
          notifications: enhancedNotifications,
          unreadCount: notifications.filter((n) => !n.read).length,
          totalCount: notifications.length,
        },
        locale
      )
    );
  }

  return null;
}

