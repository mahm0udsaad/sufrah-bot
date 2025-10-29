/**
 * Settings API for dashboard
 * Provides restaurant profile, team management, and configuration
 */

import { jsonResponse } from '../../http';
import { prisma } from '../../../db/client';
import { getLocaleFromRequest, createLocalizedResponse } from '../../../services/i18n';
import { fetchMerchantProfile } from '../../../services/sufrahApi';
import { standardizeWhatsappNumber } from '../../../utils/phone';
import { authenticateDashboard } from '../../../utils/dashboardAuth';



/**
 * Handle GET /api/settings/profile
 * Returns restaurant profile configuration
 */
export async function handleSettingsApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/settings/profile
  if (url.pathname === '/api/settings/profile' && req.method === 'GET') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: auth.restaurantId },
      include: {
        user: {
          select: {
            phone: true,
            email: true,
            name: true,
          },
        },
        bots: {
          where: { isActive: true },
          select: {
            whatsappNumber: true,
            supportContact: true,
            paymentLink: true,
          },
        },
      },
    });

    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    let merchantProfile = null;
    if (restaurant.externalMerchantId) {
      merchantProfile = await fetchMerchantProfile(restaurant.externalMerchantId);
    }

    const sloganPhoto = merchantProfile?.sloganPhoto ?? null;
    const appsLink = merchantProfile?.appsLink ?? null;
    const logoUrl = restaurant.logoUrl || sloganPhoto || null;

    const profile = {
      id: restaurant.id,
      name: restaurant.name,
      description: restaurant.description,
      address: restaurant.address,
      phone: restaurant.phone,
      whatsappNumber: restaurant.whatsappNumber,
      logoUrl,
      sloganPhoto,
      appsLink,
      isActive: restaurant.isActive,
      status: restaurant.status,
      owner: {
        name: restaurant.user.name,
        phone: restaurant.user.phone,
        email: restaurant.user.email,
      },
      bot: restaurant.bots[0] || null,
      externalMerchantId: restaurant.externalMerchantId,
      createdAt: restaurant.createdAt.toISOString(),
      updatedAt: restaurant.updatedAt.toISOString(),
    };

    return jsonResponse(createLocalizedResponse(profile, locale));
  }

  // PATCH /api/settings/profile - update profile
  if (url.pathname === '/api/settings/profile' && req.method === 'PATCH') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const body = await req.json();
    const locale = getLocaleFromRequest(req);

    const updateData: any = {};

    if (body.name) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.address !== undefined) updateData.address = body.address;
    if (body.phone !== undefined) {
      const normalizedPhone =
        typeof body.phone === 'string'
          ? standardizeWhatsappNumber(body.phone) || body.phone
          : body.phone;
      updateData.phone = normalizedPhone;
    }
    if (body.logoUrl !== undefined) updateData.logoUrl = body.logoUrl;

    if (Object.keys(updateData).length === 0) {
      return jsonResponse({ error: 'No valid fields to update' }, 400);
    }

    const updated = await prisma.restaurant.update({
      where: { id: auth.restaurantId },
      data: updateData,
    });

    return jsonResponse(
      createLocalizedResponse(
        {
          restaurantId: updated.id,
          updated: true,
          changes: updateData,
        },
        locale
      )
    );
  }

  // GET /api/settings/audit-logs
  if (url.pathname === '/api/settings/audit-logs' && req.method === 'GET') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const [logs, totalCount] = await Promise.all([
      prisma.usageLog.findMany({
        where: { restaurantId: auth.restaurantId },
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
      }),

      prisma.usageLog.count({
        where: { restaurantId: auth.restaurantId },
      }),
    ]);

    const auditLogs = logs.map((log) => ({
      id: log.id,
      action: log.action,
      details: log.details,
      createdAt: log.created_at.toISOString(),
    }));

    return jsonResponse(
      createLocalizedResponse(
        {
          logs: auditLogs,
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

  return null;
}
