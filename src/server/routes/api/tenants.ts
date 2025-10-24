/**
 * Tenant/Restaurant overview and management API
 * Provides aggregated metrics and configuration for dashboard
 */

import { jsonResponse } from '../../http';
import { getTenantOverview } from '../../../services/dashboardMetrics';
import { getLocaleFromRequest, createLocalizedResponse, type Currency } from '../../../services/i18n';
import { authenticateDashboard } from '../../../utils/dashboardAuth';
import { resolveRestaurantId } from '../../../utils/restaurantResolver';

/**
 * Handle GET /api/tenants/:id/overview
 * Returns comprehensive dashboard overview for a restaurant
 */
export async function handleTenantsApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/tenants/:id/overview
  const overviewMatch = url.pathname.match(/^\/api\/tenants\/([^/]+)\/overview$/);
  if (overviewMatch && req.method === 'GET') {
    const botId: string = overviewMatch[1]!;
    
    // Authenticate and resolve RestaurantBot ID to Restaurant ID
    const auth = await authenticateDashboard(req);

    if (!auth.ok) {
      const status = auth.error?.includes('required') ? 400 : 401;
      return jsonResponse({ error: auth.error || 'Unauthorized' }, status);
    }

    // Verify access - check against the bot ID from URL
    if (!auth.isAdmin && auth.botId !== botId) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    // Resolve the bot ID from URL to get restaurant details
    const resolved = await resolveRestaurantId(botId);
    if (!resolved) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    // Get overview metrics using the actual Restaurant ID
    const overview = await getTenantOverview(resolved.restaurantId);

    // Get locale and currency preferences
    const locale = getLocaleFromRequest(req);
    const currency = (url.searchParams.get('currency') || 'SAR') as Currency;

    return jsonResponse(
      createLocalizedResponse(
        {
          restaurantId: resolved.botId,
          restaurantName: resolved.botName,
          ...overview,
        },
        locale,
        currency
      )
    );
  }

  return null;
}

