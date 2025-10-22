/**
 * Bot management and health monitoring API
 * Provides bot configuration, status, and metrics
 */

import { jsonResponse } from '../../http';
import { DASHBOARD_PAT, BOT_API_KEY } from '../../../config';
import { prisma } from '../../../db/client';
import { getBotHealthMetrics } from '../../../services/dashboardMetrics';
import { getLocaleFromRequest, createLocalizedResponse, t } from '../../../services/i18n';

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
      return { ok: false, error: 'X-Restaurant-Id header is required for PAT' };
    }
    return { ok: true, restaurantId };
  }

  if (BOT_API_KEY && apiKeyHeader && apiKeyHeader === BOT_API_KEY) {
    return { ok: true, isAdmin: true };
  }

  return { ok: false, error: 'Unauthorized' };
}

/**
 * Get historical message statistics
 */
async function getMessageStats(restaurantId: string, hours: number = 24) {
  const now = new Date();
  const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000);

  // Get hourly message counts
  const messages = await prisma.message.findMany({
    where: {
      restaurantId,
      createdAt: { gte: startTime },
    },
    select: {
      createdAt: true,
      direction: true,
    },
  });

  // Group by hour
  const hourlyStats: { [hour: string]: { sent: number; received: number } } = {};
  
  messages.forEach((msg) => {
    const hour = msg.createdAt.toISOString().substring(0, 13) + ':00:00.000Z';
    if (!hourlyStats[hour]) {
      hourlyStats[hour] = { sent: 0, received: 0 };
    }
    if (msg.direction === 'OUT') {
      hourlyStats[hour].sent++;
    } else {
      hourlyStats[hour].received++;
    }
  });

  return Object.entries(hourlyStats).map(([hour, stats]) => ({
    timestamp: hour,
    sent: stats.sent,
    received: stats.received,
    total: stats.sent + stats.received,
  }));
}

/**
 * Handle GET /api/bot
 * Returns bot configuration and health status
 */
export async function handleBotApi(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/bot' && req.method === 'GET') {
    const auth = authenticate(req);
    if (!auth.ok) {
      const status = auth.error?.includes('required') ? 400 : 401;
      return jsonResponse({ error: auth.error || 'Unauthorized' }, status);
    }

    if (!auth.restaurantId) {
      return jsonResponse({ error: 'Restaurant ID required' }, 400);
    }

    const locale = getLocaleFromRequest(req);
    const includeHistory = url.searchParams.get('include_history') === 'true';

    // Get bot health metrics
    const botHealth = await getBotHealthMetrics(auth.restaurantId);
    
    if (!botHealth) {
      return jsonResponse({ error: 'No active bot found for this restaurant' }, 404);
    }

    let messageHistory;
    if (includeHistory) {
      const hours = parseInt(url.searchParams.get('history_hours') || '24', 10);
      messageHistory = await getMessageStats(auth.restaurantId, Math.min(hours, 168)); // Max 7 days
    }

    const response = {
      ...botHealth,
      statusDisplay: t(`bot.status.${botHealth.status.toLowerCase()}`, locale),
      verificationDisplay: botHealth.isVerified
        ? t('bot.verification.verified', locale)
        : t('bot.verification.unverified', locale),
      messageHistory: messageHistory || [],
    };

    return jsonResponse(createLocalizedResponse(response, locale));
  }

  // PATCH /api/bot - update bot settings
  if (url.pathname === '/api/bot' && req.method === 'PATCH') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = await req.json();
    const locale = getLocaleFromRequest(req);

    // Find active bot
    const bot = await prisma.restaurantBot.findFirst({
      where: {
        restaurantId: auth.restaurantId,
        isActive: true,
      },
    });

    if (!bot) {
      return jsonResponse({ error: 'No active bot found' }, 404);
    }

    // Update allowed fields
    const updateData: any = {};
    
    if (typeof body.maxMessagesPerMin === 'number') {
      updateData.maxMessagesPerMin = Math.max(1, Math.min(body.maxMessagesPerMin, 300));
    }
    
    if (typeof body.maxMessagesPerDay === 'number') {
      updateData.maxMessagesPerDay = Math.max(10, Math.min(body.maxMessagesPerDay, 10000));
    }

    if (typeof body.isActive === 'boolean') {
      updateData.isActive = body.isActive;
    }

    if (Object.keys(updateData).length === 0) {
      return jsonResponse({ error: 'No valid fields to update' }, 400);
    }

    const updatedBot = await prisma.restaurantBot.update({
      where: { id: bot.id },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
    });

    return jsonResponse(
      createLocalizedResponse(
        {
          botId: updatedBot.id,
          updated: true,
          changes: updateData,
        },
        locale
      )
    );
  }

  return null;
}

