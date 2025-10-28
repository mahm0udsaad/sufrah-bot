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
  
  console.log(`[Tenants API] Checking route: ${url.pathname}, Method: ${req.method}, Match: ${!!overviewMatch}`);
  
  if (overviewMatch && req.method === 'GET') {
    const botId: string = overviewMatch[1]!;
    
    console.log(`[Tenants API] Processing overview request for botId: ${botId}`);
    
    try {
      // Authenticate - just verify user has valid credentials
      // Note: For consistency with other dashboard APIs, we don't enforce
      // that the X-Restaurant-Id header matches the URL tenant ID.
      // The URL tenant ID is the source of truth for which data to return.
      const auth = await authenticateDashboard(req);

      if (!auth.ok) {
        console.log(`[Tenants API] Authentication failed: ${auth.error}`);
        const status = auth.error?.includes('required') ? 400 : 401;
        return jsonResponse({ error: auth.error || 'Unauthorized' }, status);
      }

      console.log(`[Tenants API] Authenticated successfully. Auth botId: ${auth.botId}, Requested botId: ${botId}`);

      // Resolve the bot ID from URL to get restaurant details
      // Using URL botId as source of truth (consistent with other dashboard APIs)
      const resolved = await resolveRestaurantId(botId);
      if (!resolved) {
        console.log(`[Tenants API] Restaurant not found for botId: ${botId}`);
        return jsonResponse({ error: 'Restaurant not found' }, 404);
      }

      console.log(`[Tenants API] Resolved botId ${botId} to restaurantId ${resolved.restaurantId}`);

      // Get overview metrics using the actual Restaurant ID
      const overview = await getTenantOverview(resolved.restaurantId);

      // Get locale and currency preferences
      const locale = getLocaleFromRequest(req);
      const currency = (url.searchParams.get('currency') || 'SAR') as Currency;

      console.log(`[Tenants API] Successfully returning overview for ${resolved.botName}`);

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
    } catch (error) {
      console.error(`[Tenants API] Error processing request:`, error);
      return jsonResponse({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : String(error) 
      }, 500);
    }
  }

  return null;
}

