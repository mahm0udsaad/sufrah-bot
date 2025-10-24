/**
 * Templates API for dashboard
 * Provides template management, preview, and usage analytics
 */

import { jsonResponse } from '../../http';
import { prisma } from '../../../db/client';
import { getLocaleFromRequest, createLocalizedResponse, t, formatRelativeTime } from '../../../services/i18n';
import { getCacheReport } from '../../../services/templateCacheMetrics';
import { authenticateDashboard } from '../../../utils/dashboardAuth';

type AuthResult = { ok: boolean; restaurantId?: string; userId?: string; isAdmin?: boolean; error?: string };

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
 * Handle GET /api/templates
 * Returns list of templates with usage analytics
 */
export async function handleTemplatesApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/templates - list templates
  if (url.pathname === '/api/templates' && req.method === 'GET') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const status = url.searchParams.get('status');
    const category = url.searchParams.get('category');

    // Get restaurant's user ID to find templates
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: auth.restaurantId },
      select: { userId: true },
    });

    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    const whereClause: any = {
      user_id: restaurant.userId,
    };

    if (status) {
      whereClause.status = status;
    }

    if (category) {
      whereClause.category = category;
    }

    const [templates, totalCount] = await Promise.all([
      prisma.template.findMany({
        where: whereClause,
        orderBy: { updated_at: 'desc' },
        take: limit,
        skip: offset,
      }),

      prisma.template.count({ where: whereClause }),
    ]);

    // Enhance with ContentTemplateCache data
    const enhancedTemplates = await Promise.all(
      templates.map(async (template) => {
        // Find cache entries for this template
        const cacheEntries = await prisma.contentTemplateCache.findMany({
          where: {
            friendlyName: template.name,
          },
          select: {
            lastUsedAt: true,
            templateSid: true,
          },
          orderBy: { lastUsedAt: 'desc' },
          take: 1,
        });

        const lastUsed = cacheEntries[0]?.lastUsedAt || null;
        const templateSid = template.whatsapp_template_id || cacheEntries[0]?.templateSid || null;

        return {
          id: template.id,
          name: template.name,
          category: template.category,
          language: template.language,
          status: template.status,
          statusDisplay: t(`template.status.${template.status || 'draft'}`, locale),
          templateSid,
          usageCount: template.usage_count || 0,
          lastUsed: lastUsed?.toISOString() || null,
          lastUsedRelative: lastUsed ? formatRelativeTime(lastUsed, locale) : null,
          createdAt: template.created_at.toISOString(),
          updatedAt: template.updated_at.toISOString(),
          hasVariables: Array.isArray(template.variables) && template.variables.length > 0,
        };
      })
    );

    return jsonResponse(
      createLocalizedResponse(
        {
          templates: enhancedTemplates,
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

  // GET /api/templates/:id - get template details
  const templateMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (templateMatch && req.method === 'GET') {
    const templateId = templateMatch[1];
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);

    // Get restaurant's user ID
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: auth.restaurantId },
      select: { userId: true },
    });

    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    const template = await prisma.template.findFirst({
      where: {
        id: templateId,
        user_id: restaurant.userId,
      },
    });

    if (!template) {
      return jsonResponse({ error: 'Template not found' }, 404);
    }

    // Get cache analytics
    const cacheEntries = await prisma.contentTemplateCache.findMany({
      where: {
        friendlyName: template.name,
      },
    });

    const analytics = {
      totalCacheHits: cacheEntries.length,
      uniqueVariations: cacheEntries.length,
      lastUsed: cacheEntries.length > 0 
        ? cacheEntries.reduce((latest, entry) => 
            entry.lastUsedAt > latest ? entry.lastUsedAt : latest, 
            cacheEntries[0].lastUsedAt
          ).toISOString()
        : null,
    };

    return jsonResponse(
      createLocalizedResponse(
        {
          id: template.id,
          name: template.name,
          category: template.category,
          language: template.language,
          status: template.status,
          statusDisplay: t(`template.status.${template.status || 'draft'}`, locale),
          headerType: template.header_type,
          headerContent: template.header_content,
          bodyText: template.body_text,
          footerText: template.footer_text,
          buttons: template.buttons,
          variables: template.variables,
          templateSid: template.whatsapp_template_id,
          usageCount: template.usage_count || 0,
          createdAt: template.created_at.toISOString(),
          updatedAt: template.updated_at.toISOString(),
          analytics,
        },
        locale
      )
    );
  }

  // GET /api/templates/cache/metrics - cache performance metrics
  if (url.pathname === '/api/templates/cache/metrics' && req.method === 'GET') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const metrics = await getCacheReport();

    return jsonResponse(createLocalizedResponse(metrics, locale));
  }

  // POST /api/templates - create template
  if (url.pathname === '/api/templates' && req.method === 'POST') {
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const body = await req.json();
    const locale = getLocaleFromRequest(req);

    // Get restaurant's user ID
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: auth.restaurantId },
      select: { userId: true },
    });

    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    // Validate required fields
    if (!body.name || !body.category || !body.body_text) {
      return jsonResponse({ error: 'Missing required fields: name, category, body_text' }, 400);
    }

    const template = await prisma.template.create({
      data: {
        user_id: restaurant.userId,
        name: body.name,
        category: body.category,
        language: body.language || 'en',
        header_type: body.header_type || null,
        header_content: body.header_content || null,
        body_text: body.body_text,
        footer_text: body.footer_text || null,
        buttons: body.buttons || [],
        variables: body.variables || [],
        status: 'draft',
      },
    });

    return jsonResponse(
      createLocalizedResponse(
        {
          template: {
            id: template.id,
            name: template.name,
            status: template.status,
          },
          message: 'Template created successfully',
        },
        locale
      ),
      201
    );
  }

  // PATCH /api/templates/:id - update template
  if (templateMatch && req.method === 'PATCH') {
    const templateId = templateMatch[1];
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const body = await req.json();
    const locale = getLocaleFromRequest(req);

    // Get restaurant's user ID
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: auth.restaurantId },
      select: { userId: true },
    });

    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    // Verify template ownership
    const existing = await prisma.template.findFirst({
      where: {
        id: templateId,
        user_id: restaurant.userId,
      },
    });

    if (!existing) {
      return jsonResponse({ error: 'Template not found' }, 404);
    }

    const updateData: any = {};
    
    if (body.name) updateData.name = body.name;
    if (body.category) updateData.category = body.category;
    if (body.language) updateData.language = body.language;
    if (body.header_type !== undefined) updateData.header_type = body.header_type;
    if (body.header_content !== undefined) updateData.header_content = body.header_content;
    if (body.body_text) updateData.body_text = body.body_text;
    if (body.footer_text !== undefined) updateData.footer_text = body.footer_text;
    if (body.buttons !== undefined) updateData.buttons = body.buttons;
    if (body.variables !== undefined) updateData.variables = body.variables;
    if (body.status) updateData.status = body.status;

    const updated = await prisma.template.update({
      where: { id: templateId },
      data: updateData,
    });

    return jsonResponse(
      createLocalizedResponse(
        {
          template: {
            id: updated.id,
            name: updated.name,
            status: updated.status,
          },
          message: 'Template updated successfully',
        },
        locale
      )
    );
  }

  // DELETE /api/templates/:id - delete template
  if (templateMatch && req.method === 'DELETE') {
    const templateId = templateMatch[1];
    const auth = await authenticateDashboard(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: auth.error || 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);

    // Get restaurant's user ID
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: auth.restaurantId },
      select: { userId: true },
    });

    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found' }, 404);
    }

    // Verify template ownership
    const existing = await prisma.template.findFirst({
      where: {
        id: templateId,
        user_id: restaurant.userId,
      },
    });

    if (!existing) {
      return jsonResponse({ error: 'Template not found' }, 404);
    }

    await prisma.template.delete({
      where: { id: templateId },
    });

    return jsonResponse(
      createLocalizedResponse(
        {
          templateId,
          message: 'Template deleted successfully',
        },
        locale
      )
    );
  }

  return null;
}

