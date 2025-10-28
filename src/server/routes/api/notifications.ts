/**
 * Notifications API for dashboard
 * Provides real-time notification feed for owner alerts
 */

import { jsonResponse } from '../../http';
import { DASHBOARD_PAT, BOT_API_KEY } from '../../../config';
import {
  listNotificationsForRestaurant,
  sendWelcomeBroadcast,
  sendWelcomeBroadcastForAllRestaurants,
} from '../../../services/notificationFeed';

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
 * Handle notifications API (GET feed, POST welcome broadcast)
 */
export async function handleNotificationsApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/notifications
  if (url.pathname === '/api/notifications' && req.method === 'GET') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      const status = auth.error?.includes('required') ? 400 : 401;
      return jsonResponse({ success: false, error: auth.error || 'Unauthorized' }, status);
    }

    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
    const cursor = url.searchParams.get('cursor') || undefined;
    const includeRead = url.searchParams.get('include_read') === 'true';

    const { notifications, nextCursor, unreadCount } = await listNotificationsForRestaurant(
      auth.restaurantId,
      limit,
      cursor
    );

    const filtered = includeRead
      ? notifications
      : notifications.filter((notification) => notification.status === 'unread');

    return jsonResponse({
      success: true,
      data: {
        notifications: filtered,
        nextCursor,
        unreadCount,
      },
    });
  }

  // POST /api/notifications/welcome-broadcast
  if (url.pathname === '/api/notifications/welcome-broadcast' && req.method === 'POST') {
    const auth = authenticate(req);
    if (!auth.ok) {
      const status = auth.error?.includes('required') ? 400 : 401;
      return jsonResponse({ success: false, error: auth.error || 'Unauthorized' }, status);
    }

    const body = await req.json().catch(() => ({}));

    if (auth.isAdmin && body?.scope === 'all') {
      const result = await sendWelcomeBroadcastForAllRestaurants();
      return jsonResponse({ success: true, data: result });
    }

    const targetRestaurantId = auth.isAdmin
      ? (typeof body?.restaurantId === 'string' ? body.restaurantId : undefined)
      : auth.restaurantId;

    if (!targetRestaurantId) {
      return jsonResponse({ success: false, error: 'restaurantId is required' }, 400);
    }

    const result = await sendWelcomeBroadcast({
      restaurantId: targetRestaurantId,
      force: body?.force === true,
    });

    return jsonResponse({
      success: true,
      data: {
        restaurantId: targetRestaurantId,
        ...result,
      },
    });
  }

  return null;
}
