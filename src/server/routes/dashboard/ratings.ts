/**
 * Ratings and reviews API for dashboard
 * Provides rating analytics, distribution, NPS, and review management
 */

import { jsonResponse } from '../../http';
import { prisma } from '../../../db/client';
import { getLocaleFromRequest, createLocalizedResponse, formatRelativeTime } from '../../../services/i18n';
import { authenticateDashboard } from '../../../utils/dashboardAuth';



/**
 * Calculate NPS (Net Promoter Score)
 * NPS = % Promoters (9-10) - % Detractors (0-6)
 * Passives (7-8) don't affect the score
 */
function calculateNPS(ratings: number[]): number {
  if (ratings.length === 0) return 0;
  
  const promoters = ratings.filter((r) => r >= 9).length;
  const detractors = ratings.filter((r) => r <= 6).length;
  const total = ratings.length;
  
  return Math.round(((promoters - detractors) / total) * 100);
}

/**
 * Handle GET /api/ratings
 * Returns rating analytics and reviews
 */
export async function handleRatingsApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/ratings - rating analytics
  if (url.pathname === '/api/ratings' && req.method === 'GET') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get all ratings in period
    const ratings = await prisma.order.findMany({
      where: {
        restaurantId: auth.restaurantId,
        rating: { not: null },
        ratedAt: { gte: startDate },
      },
      select: {
        rating: true,
        ratingComment: true,
        ratedAt: true,
        branchName: true,
      },
    });

    const ratingValues = ratings.map((r) => r.rating!);
    
    // Calculate distribution
    const distribution: { [key: number]: number } = {};
    for (let i = 1; i <= 10; i++) {
      distribution[i] = ratingValues.filter((r) => r === i).length;
    }

    // Calculate average
    const average = ratingValues.length > 0
      ? ratingValues.reduce((sum, r) => sum + r, 0) / ratingValues.length
      : 0;

    // Calculate NPS
    const nps = calculateNPS(ratingValues);

    // Get ratings with comments
    const withComments = ratings.filter((r) => r.ratingComment && r.ratingComment.trim().length > 0);

    // Get rating trend (compare to previous period)
    const previousStartDate = new Date(startDate.getTime() - days * 24 * 60 * 60 * 1000);
    const previousRatings = await prisma.order.findMany({
      where: {
        restaurantId: auth.restaurantId,
        rating: { not: null },
        ratedAt: {
          gte: previousStartDate,
          lt: startDate,
        },
      },
      select: { rating: true },
    });

    const previousAverage = previousRatings.length > 0
      ? previousRatings.reduce((sum, r) => sum + r.rating!, 0) / previousRatings.length
      : average;

    const trend = average > previousAverage ? 'up' : average < previousAverage ? 'down' : 'stable';
    const changePercent = previousAverage > 0 ? ((average - previousAverage) / previousAverage) * 100 : 0;

    // Group by rating category
    const promoters = ratingValues.filter((r) => r >= 9).length;
    const passives = ratingValues.filter((r) => r >= 7 && r <= 8).length;
    const detractors = ratingValues.filter((r) => r <= 6).length;

    const analytics = {
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        totalRatings: ratingValues.length,
        averageRating: Math.round(average * 10) / 10,
        nps,
        responseRate: 0, // TODO: Calculate based on rating asks vs responses
        trend,
        changePercent: Math.round(changePercent * 10) / 10,
      },
      distribution,
      segments: {
        promoters,
        passives,
        detractors,
        promotersPercent: ratingValues.length > 0 ? Math.round((promoters / ratingValues.length) * 100) : 0,
        passivesPercent: ratingValues.length > 0 ? Math.round((passives / ratingValues.length) * 100) : 0,
        detractorsPercent: ratingValues.length > 0 ? Math.round((detractors / ratingValues.length) * 100) : 0,
      },
      withComments: withComments.length,
    };

    return jsonResponse(createLocalizedResponse(analytics, locale));
  }

  // GET /api/ratings/reviews - list reviews with comments
  if (url.pathname === '/api/ratings/reviews' && req.method === 'GET') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const minRating = parseInt(url.searchParams.get('min_rating') || '1', 10);
    const maxRating = parseInt(url.searchParams.get('max_rating') || '10', 10);
    const withComments = url.searchParams.get('with_comments') === 'true';

    const whereClause: any = {
      restaurantId: auth.restaurantId,
      rating: {
        gte: minRating,
        lte: maxRating,
      },
    };

    if (withComments) {
      whereClause.ratingComment = { not: null };
    }

    const [reviews, totalCount] = await Promise.all([
      prisma.order.findMany({
        where: whereClause,
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
      }),

      prisma.order.count({ where: whereClause }),
    ]);

    const reviewList = reviews.map((order) => ({
      orderId: order.id,
      orderReference: order.orderReference,
      rating: order.rating,
      comment: order.ratingComment,
      customer: {
        name: order.conversation.customerName || 'Unknown',
        phone: order.conversation.customerWa,
      },
      branchName: order.branchName,
      ratedAt: order.ratedAt?.toISOString() || null,
      ratedAtRelative: order.ratedAt ? formatRelativeTime(order.ratedAt, locale) : null,
      orderCreatedAt: order.createdAt.toISOString(),
    }));

    return jsonResponse(
      createLocalizedResponse(
        {
          reviews: reviewList,
          pagination: {
            total: totalCount,
            limit,
            offset,
            hasMore: offset + limit < totalCount,
          },
        },
        locale
      )
    );
  }

  // GET /api/ratings/timeline - rating trend over time
  if (url.pathname === '/api/ratings/timeline' && req.method === 'GET') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const days = Math.min(parseInt(url.searchParams.get('days') || '30', 10), 365);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get ratings grouped by day
    const ratings = await prisma.order.findMany({
      where: {
        restaurantId: auth.restaurantId,
        rating: { not: null },
        ratedAt: { gte: startDate },
      },
      select: {
        rating: true,
        ratedAt: true,
      },
      orderBy: { ratedAt: 'asc' },
    });

    // Group by day
    const dailyRatings: { [date: string]: number[] } = {};
    
    ratings.forEach((r) => {
      if (!r.ratedAt) return;
      const date = r.ratedAt.toISOString().split('T')[0];
      if (!dailyRatings[date]) {
        dailyRatings[date] = [];
      }
      dailyRatings[date].push(r.rating!);
    });

    const timeline = Object.entries(dailyRatings).map(([date, ratings]) => ({
      date,
      count: ratings.length,
      average: Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 10) / 10,
      nps: calculateNPS(ratings),
    }));

    return jsonResponse(createLocalizedResponse({ timeline }, locale));
  }

  return null;
}
