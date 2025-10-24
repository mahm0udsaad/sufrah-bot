/**
 * Catalog management API for dashboard
 * Provides Sufrah catalog snapshots and sync monitoring
 */

import { jsonResponse } from '../../http';
import { getLocaleFromRequest, createLocalizedResponse, formatRelativeTime } from '../../../services/i18n';
import { fetchMerchantCategories, fetchMerchantBranches, fetchCategoryProducts } from '../../../services/sufrahApi';
import { getRestaurantById } from '../../../db/restaurantService';
import { authenticateDashboard } from '../../../utils/dashboardAuth';



/**
 * Handle GET /api/catalog/categories
 * Returns catalog categories from Sufrah
 */
export async function handleCatalogApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/catalog/categories
  if (url.pathname === '/api/catalog/categories' && req.method === 'GET') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
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

  // GET /api/catalog/items
  if (url.pathname === '/api/catalog/items' && req.method === 'GET') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const categoryId = url.searchParams.get('categoryId');

    const restaurant = await getRestaurantById(auth.restaurantId);
    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    if (!restaurant.externalMerchantId) {
      return jsonResponse({ error: 'Restaurant not linked to Sufrah merchant' }, 400);
    }

    try {
      let allItems: any[] = [];

      if (categoryId) {
        // Fetch items for specific category
        allItems = await fetchCategoryProducts(categoryId);
      } else {
        // Fetch all categories first, then get items from all of them
        const categories = await fetchMerchantCategories(restaurant.externalMerchantId);
        
        // Fetch items from all categories in parallel
        const itemsPromises = categories.map(async (cat: any) => {
          try {
            const items = await fetchCategoryProducts(cat.id);
            return items.map((item: any) => ({
              ...item,
              categoryId: cat.id,
              categoryName: cat.name || cat.nameEn,
              categoryNameAr: cat.nameAr,
            }));
          } catch (err) {
            console.error(`Failed to fetch items for category ${cat.id}:`, err);
            return [];
          }
        });

        const itemsArrays = await Promise.all(itemsPromises);
        allItems = itemsArrays.flat();
      }

      // Format items for response
      const formattedItems = allItems.map((item: any) => ({
        id: item.id,
        name: item.nameEn || item.name,
        nameAr: item.nameAr,
        description: item.descriptionEn || item.description,
        descriptionAr: item.descriptionAr,
        price: typeof item.price === 'string' ? parseFloat(item.price) : item.price,
        priceAfter: item.priceAfter ? (typeof item.priceAfter === 'string' ? parseFloat(item.priceAfter) : item.priceAfter) : null,
        currency: item.currency || restaurant.currency || 'SAR',
        imageUrl: item.imageUrl || item.avatar || (Array.isArray(item.images) && item.images[0]) || null,
        available: item.isAvailableToDelivery !== false && item.isAvailableToReceipt !== false,
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        categoryNameAr: item.categoryNameAr,
      }));

      const availableCount = formattedItems.filter((item: any) => item.available).length;

      return jsonResponse(
        createLocalizedResponse(
          {
            merchantId: restaurant.externalMerchantId,
            items: formattedItems,
            summary: {
              totalItems: formattedItems.length,
              availableItems: availableCount,
              unavailableItems: formattedItems.length - availableCount,
            },
            lastSync: new Date().toISOString(),
          },
          locale
        )
      );
    } catch (error) {
      return jsonResponse({ error: 'Failed to fetch items', details: error }, 500);
    }
  }

  // GET /api/catalog/branches
  if (url.pathname === '/api/catalog/branches' && req.method === 'GET') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
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
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
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

