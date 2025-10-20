import { jsonResponse } from '../../http';
import { prisma } from '../../../db/client';
import { DASHBOARD_PAT } from '../../../config';

/**
 * RATINGS API ENDPOINT
 * Provides access to customer ratings for the dashboard
 * Authenticated with X-Restaurant-ID header
 */

interface RatingApiResponse {
  id: string;
  orderReference: string | null;
  orderNumber: number | null;
  restaurantId: string;
  conversationId: string;
  customerPhone: string;
  customerName: string | null;
  rating: number;
  ratingComment: string | null;
  ratedAt: string;
  ratingAskedAt: string | null;
  orderType: string | null;
  paymentMethod: string | null;
  totalCents: number;
  currency: string;
  branchId: string | null;
  branchName: string | null;
  orderCreatedAt: string;
}

function authenticate(req: Request): { ok: boolean; restaurantId?: string; error?: string } {
  const restaurantId = req.headers.get('X-Restaurant-ID');
  if (!restaurantId) {
    return { ok: false, error: 'X-Restaurant-ID header is required' };
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return { ok: false, error: 'Authorization header is required' };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (token !== DASHBOARD_PAT) {
    return { ok: false, error: 'Unauthorized' };
  }

  return { ok: true, restaurantId };
}

export async function handleRatingsApi(req: Request, url: URL): Promise<Response | null> {
  // Only handle /api/db/ratings endpoint
  if (!url.pathname.startsWith('/api/db/ratings')) {
    return null;
  }

  const auth = authenticate(req);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error || 'Unauthorized' }, auth.error?.includes('required') ? 400 : 401);
  }

  const restaurantId = auth.restaurantId!;

  // GET /api/db/ratings - List all ratings for restaurant
  if (req.method === 'GET' && url.pathname === '/api/db/ratings') {
    try {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const minRating = url.searchParams.get('minRating') 
        ? parseInt(url.searchParams.get('minRating')!, 10) 
        : undefined;
      const maxRating = url.searchParams.get('maxRating') 
        ? parseInt(url.searchParams.get('maxRating')!, 10) 
        : undefined;

      // Build where clause
      const where: any = {
        restaurantId,
        rating: {
          not: null,
        },
      };

      if (minRating !== undefined || maxRating !== undefined) {
        where.rating = {
          ...where.rating,
          ...(minRating !== undefined && { gte: minRating }),
          ...(maxRating !== undefined && { lte: maxRating }),
        };
      }

      const orders = await prisma.order.findMany({
        where,
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
      });

      const response: RatingApiResponse[] = orders.map((order) => {
        // Extract order number from meta if available
        const orderNumber = typeof order.meta === 'object' && order.meta !== null
          ? (order.meta as any).orderNumber || null
          : null;

        return {
          id: order.id,
          orderReference: order.orderReference,
          orderNumber,
          restaurantId: order.restaurantId,
          conversationId: order.conversationId,
          customerPhone: order.conversation.customerWa,
          customerName: order.conversation.customerName,
          rating: order.rating!,
          ratingComment: order.ratingComment,
          ratedAt: order.ratedAt!.toISOString(),
          ratingAskedAt: order.ratingAskedAt ? order.ratingAskedAt.toISOString() : null,
          orderType: order.orderType,
          paymentMethod: order.paymentMethod,
          totalCents: order.totalCents,
          currency: order.currency,
          branchId: order.branchId,
          branchName: order.branchName,
          orderCreatedAt: order.createdAt.toISOString(),
        };
      });

      return jsonResponse(response);
    } catch (error) {
      console.error('❌ Failed to list ratings from DB:', error);
      return jsonResponse({ error: 'Failed to fetch ratings' }, 500);
    }
  }

  // GET /api/db/ratings/stats - Get rating statistics
  if (req.method === 'GET' && url.pathname === '/api/db/ratings/stats') {
    try {
      const orders = await prisma.order.findMany({
        where: {
          restaurantId,
          rating: {
            not: null,
          },
        },
        select: {
          rating: true,
        },
      });

      const totalRatings = orders.length;
      const ratingCounts = [0, 0, 0, 0, 0]; // Index 0 = 1 star, Index 4 = 5 stars
      let sumRatings = 0;

      orders.forEach((order) => {
        if (order.rating !== null) {
          ratingCounts[order.rating - 1]++;
          sumRatings += order.rating;
        }
      });

      const averageRating = totalRatings > 0 ? sumRatings / totalRatings : 0;

      return jsonResponse({
        totalRatings,
        averageRating: parseFloat(averageRating.toFixed(2)),
        distribution: {
          1: ratingCounts[0],
          2: ratingCounts[1],
          3: ratingCounts[2],
          4: ratingCounts[3],
          5: ratingCounts[4],
        },
      });
    } catch (error) {
      console.error('❌ Failed to fetch rating stats:', error);
      return jsonResponse({ error: 'Failed to fetch rating statistics' }, 500);
    }
  }

  // GET /api/db/ratings/:id - Get specific rating
  const getRatingMatch = url.pathname.match(/^\/api\/db\/ratings\/([^/]+)$/);
  if (req.method === 'GET' && getRatingMatch) {
    try {
      const orderId = getRatingMatch[1];

      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          restaurantId,
          rating: {
            not: null,
          },
        },
        include: {
          conversation: {
            select: {
              customerWa: true,
              customerName: true,
            },
          },
          items: true,
        },
      });

      if (!order) {
        return jsonResponse({ error: 'Rating not found' }, 404);
      }

      // Extract order number from meta if available
      const orderNumber = typeof order.meta === 'object' && order.meta !== null
        ? (order.meta as any).orderNumber || null
        : null;

      const response: RatingApiResponse & { items?: any[] } = {
        id: order.id,
        orderReference: order.orderReference,
        orderNumber,
        restaurantId: order.restaurantId,
        conversationId: order.conversationId,
        customerPhone: order.conversation.customerWa,
        customerName: order.conversation.customerName,
        rating: order.rating!,
        ratingComment: order.ratingComment,
        ratedAt: order.ratedAt!.toISOString(),
        ratingAskedAt: order.ratingAskedAt ? order.ratingAskedAt.toISOString() : null,
        orderType: order.orderType,
        paymentMethod: order.paymentMethod,
        totalCents: order.totalCents,
        currency: order.currency,
        branchId: order.branchId,
        branchName: order.branchName,
        orderCreatedAt: order.createdAt.toISOString(),
        items: order.items.map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.qty,
          unitCents: item.unitCents,
          totalCents: item.totalCents,
        })),
      };

      return jsonResponse(response);
    } catch (error) {
      console.error('❌ Failed to fetch rating:', error);
      return jsonResponse({ error: 'Failed to fetch rating' }, 500);
    }
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

