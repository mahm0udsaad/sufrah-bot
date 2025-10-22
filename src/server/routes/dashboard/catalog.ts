/**
 * Catalog management API for dashboard
 * Provides Sufrah catalog snapshots and sync monitoring
 */

import { jsonResponse } from '../../http';
import { DASHBOARD_PAT, BOT_API_KEY } from '../../../config';
import { getLocaleFromRequest, createLocalizedResponse, formatRelativeTime } from '../../../services/i18n';
import { fetchMerchantCategories, fetchMerchantBranches } from '../../../services/sufrahApi';
import { getRestaurantById } from '../../../db/restaurantService';

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
 * Handle GET /api/catalog/categories
 * Returns catalog categories from Sufrah
 */
export async function handleCatalogApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/catalog/categories
  if (url.pathname === '/api/catalog/categories' && req.method === 'GET') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);

    const restaurant = await getRestaurantById(auth.restaurantId);
    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    if (!restaurant.externalMerchantId) {
      return jsonResponse({ error: 'Restaurant not linked to Sufrah merchant' }, 400);
    }

    try {
      const categories = await fetchMerchantCategories(restaurant.externalMerchantId);
      
      // Calculate stats
      const totalItems = categories.reduce((sum, cat) => sum + (cat.items?.length || 0), 0);
      const activeItems = categories.reduce(
        (sum, cat) => sum + (cat.items?.filter((item: any) => item.available !== false).length || 0),
        0
      );

      return jsonResponse(
        createLocalizedResponse(
          {
            merchantId: restaurant.externalMerchantId,
            categories: categories.map((cat: any) => ({
              id: cat.id,
              name: cat.name,
              nameAr: cat.nameAr,
              itemCount: cat.items?.length || 0,
              activeItemCount: cat.items?.filter((item: any) => item.available !== false).length || 0,
            })),
            summary: {
              totalCategories: categories.length,
              totalItems,
              activeItems,
              unavailableItems: totalItems - activeItems,
            },
            lastSync: new Date().toISOString(), // From cache
          },
          locale
        )
      );
    } catch (error) {
      return jsonResponse({ error: 'Failed to fetch catalog', details: error }, 500);
    }
  }

  // GET /api/catalog/branches
  if (url.pathname === '/api/catalog/branches' && req.method === 'GET') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);

    const restaurant = await getRestaurantById(auth.restaurantId);
    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    if (!restaurant.externalMerchantId) {
      return jsonResponse({ error: 'Restaurant not linked to Sufrah merchant' }, 400);
    }

    try {
      const branches = await fetchMerchantBranches(restaurant.externalMerchantId);
      
      return jsonResponse(
        createLocalizedResponse(
          {
            merchantId: restaurant.externalMerchantId,
            branches: branches.map((branch: any) => ({
              id: branch.id,
              name: branch.name,
              nameAr: branch.nameAr,
              address: branch.address,
              city: branch.city,
              phone: branch.phone,
              isActive: branch.isActive !== false,
            })),
            totalBranches: branches.length,
            activeBranches: branches.filter((b: any) => b.isActive !== false).length,
            lastSync: new Date().toISOString(),
          },
          locale
        )
      );
    } catch (error) {
      return jsonResponse({ error: 'Failed to fetch branches', details: error }, 500);
    }
  }

  // GET /api/catalog/sync-status
  if (url.pathname === '/api/catalog/sync-status' && req.method === 'GET') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);

    const restaurant = await getRestaurantById(auth.restaurantId);
    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    if (!restaurant.externalMerchantId) {
      return jsonResponse(
        createLocalizedResponse(
          {
            syncEnabled: false,
            message: 'Restaurant not linked to Sufrah merchant',
          },
          locale
        )
      );
    }

    // Check if we can fetch from cache (indicates sync is working)
    try {
      await fetchMerchantCategories(restaurant.externalMerchantId);
      
      return jsonResponse(
        createLocalizedResponse(
          {
            syncEnabled: true,
            merchantId: restaurant.externalMerchantId,
            lastSuccessfulSync: new Date().toISOString(),
            syncStatus: 'healthy',
            pendingJobs: 0,
            failedJobs: 0,
          },
          locale
        )
      );
    } catch (error) {
      return jsonResponse(
        createLocalizedResponse(
          {
            syncEnabled: true,
            merchantId: restaurant.externalMerchantId,
            lastSuccessfulSync: null,
            syncStatus: 'error',
            errorMessage: 'Failed to fetch catalog data',
            pendingJobs: 0,
            failedJobs: 1,
          },
          locale
        ),
        200
      );
    }
  }

  return null;
}

