/**
 * Tenant/Restaurant overview and management API
 * Provides aggregated metrics and configuration for dashboard
 */

import { jsonResponse } from '../../http';
import { DASHBOARD_PAT, BOT_API_KEY } from '../../../config';
import { getTenantOverview } from '../../../services/dashboardMetrics';
import { getLocaleFromRequest, createLocalizedResponse, Currency } from '../../../services/i18n';
import { getRestaurantById } from '../../../db/restaurantService';

type AuthResult = { ok: boolean; restaurantId?: string; isAdmin?: boolean; error?: string };

/**
 * Authenticate request
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
 * Handle GET /api/tenants/:id/overview
 * Returns comprehensive dashboard overview for a restaurant
 */
export async function handleTenantsApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/tenants/:id/overview
  const overviewMatch = url.pathname.match(/^\/api\/tenants\/([^/]+)\/overview$/);
  if (overviewMatch && req.method === 'GET') {
    const restaurantId = overviewMatch[1];
    const auth = authenticate(req);

    if (!auth.ok) {
      const status = auth.error?.includes('required') ? 400 : 401;
      return jsonResponse({ error: auth.error || 'Unauthorized' }, status);
    }

    // Verify access
    if (!auth.isAdmin && auth.restaurantId !== restaurantId) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    // Verify restaurant exists
    const restaurant = await getRestaurantById(restaurantId);
    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    // Get overview metrics
    const overview = await getTenantOverview(restaurantId);

    // Get locale and currency preferences
    const locale = getLocaleFromRequest(req);
    const currency = (url.searchParams.get('currency') || 'SAR') as Currency;

    return jsonResponse(
      createLocalizedResponse(
        {
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          ...overview,
        },
        locale,
        currency
      )
    );
  }

  return null;
}

