/**
 * Logs and audit trail API for dashboard
 * Provides webhook logs, audit trails, and compliance exports
 */

import { jsonResponse } from '../../http';
import { DASHBOARD_PAT, BOT_API_KEY } from '../../../config';
import { prisma } from '../../../db/client';
import { getLocaleFromRequest, createLocalizedResponse, formatRelativeTime } from '../../../services/i18n';

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
 * Determine log severity based on status code and content
 */
function getLogSeverity(statusCode: number | null, errorMessage: string | null): 'info' | 'warning' | 'error' {
  if (errorMessage) return 'error';
  if (!statusCode) return 'info';
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warning';
  return 'info';
}

/**
 * Handle GET /api/logs
 * Returns webhook logs with filtering and correlation
 */
export async function handleLogsApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/logs - list logs
  if (url.pathname === '/api/logs' && req.method === 'GET') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 500);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const eventType = url.searchParams.get('event_type'); // 'webhook', 'queue_send', 'owner_action'
    const severity = url.searchParams.get('severity'); // 'info', 'warning', 'error'
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');

    const whereClause: any = {
      restaurantId: auth.restaurantId,
    };

    // Apply filters
    if (severity) {
      if (severity === 'error') {
        whereClause.statusCode = { gte: 400 };
      } else if (severity === 'warning') {
        whereClause.statusCode = { gte: 400, lt: 500 };
      }
    }

    if (startDate) {
      whereClause.createdAt = { gte: new Date(startDate) };
    }

    if (endDate) {
      whereClause.createdAt = {
        ...whereClause.createdAt,
        lte: new Date(endDate),
      };
    }

    const [logs, totalCount] = await Promise.all([
      prisma.webhookLog.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),

      prisma.webhookLog.count({ where: whereClause }),
    ]);

    // Enhance logs with additional context
    const enhancedLogs = await Promise.all(
      logs.map(async (log) => {
        const body = log.body as any;
        const severity = getLogSeverity(log.statusCode, log.errorMessage);

        // Try to correlate with order or message
        let correlatedOrderId = null;
        let correlatedMessageSid = null;

        if (body?.MessageSid) {
          correlatedMessageSid = body.MessageSid;
        }

        // Calculate response latency (if available in headers)
        const headers = log.headers as any;
        const responseLatency = headers?.['x-response-time'] || null;

        return {
          id: log.id,
          requestId: log.requestId,
          method: log.method,
          path: log.path,
          statusCode: log.statusCode,
          errorMessage: log.errorMessage,
          severity,
          correlatedOrderId,
          correlatedMessageSid,
          responseLatency,
          createdAt: log.createdAt.toISOString(),
          createdAtRelative: formatRelativeTime(log.createdAt, locale),
          preview: body?.Body?.substring(0, 100) || log.path,
        };
      })
    );

    return jsonResponse(
      createLocalizedResponse(
        {
          logs: enhancedLogs,
          pagination: {
            total: totalCount,
            limit,
            offset,
            hasMore: offset + limit < totalCount,
          },
          retentionPolicy: {
            days: 90,
            message: 'Logs are retained for 90 days',
          },
        },
        locale
      )
    );
  }

  // GET /api/logs/:id - get single log with full details
  const logMatch = url.pathname.match(/^\/api\/logs\/([^/]+)$/);
  if (logMatch && req.method === 'GET') {
    const logId = logMatch[1];
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);

    const log = await prisma.webhookLog.findFirst({
      where: {
        id: logId,
        restaurantId: auth.restaurantId,
      },
    });

    if (!log) {
      return jsonResponse({ error: 'Log not found' }, 404);
    }

    const severity = getLogSeverity(log.statusCode, log.errorMessage);

    return jsonResponse(
      createLocalizedResponse(
        {
          id: log.id,
          requestId: log.requestId,
          method: log.method,
          path: log.path,
          headers: log.headers,
          body: log.body,
          statusCode: log.statusCode,
          errorMessage: log.errorMessage,
          severity,
          createdAt: log.createdAt.toISOString(),
          createdAtRelative: formatRelativeTime(log.createdAt, locale),
        },
        locale
      )
    );
  }

  // GET /api/logs/export - export logs for compliance
  if (url.pathname === '/api/logs/export' && req.method === 'GET') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');

    if (!startDate || !endDate) {
      return jsonResponse({ error: 'start_date and end_date are required' }, 400);
    }

    const logs = await prisma.webhookLog.findMany({
      where: {
        restaurantId: auth.restaurantId,
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Generate CSV
    const lines: string[] = [
      'Timestamp,Request ID,Method,Path,Status Code,Error Message',
    ];

    logs.forEach((log) => {
      const row = [
        log.createdAt.toISOString(),
        log.requestId,
        log.method,
        log.path,
        log.statusCode?.toString() || '',
        log.errorMessage || '',
      ].map((val) => `"${val.replace(/"/g, '""')}"`);
      lines.push(row.join(','));
    });

    const content = lines.join('\n');

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="logs-${startDate}-${endDate}.csv"`,
      },
    });
  }

  // GET /api/logs/stats - log statistics
  if (url.pathname === '/api/logs/stats' && req.method === 'GET') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const hours = Math.min(parseInt(url.searchParams.get('hours') || '24', 10), 168);
    const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [totalLogs, errorLogs, warningLogs] = await Promise.all([
      prisma.webhookLog.count({
        where: {
          restaurantId: auth.restaurantId,
          createdAt: { gte: startDate },
        },
      }),

      prisma.webhookLog.count({
        where: {
          restaurantId: auth.restaurantId,
          createdAt: { gte: startDate },
          statusCode: { gte: 500 },
        },
      }),

      prisma.webhookLog.count({
        where: {
          restaurantId: auth.restaurantId,
          createdAt: { gte: startDate },
          statusCode: { gte: 400, lt: 500 },
        },
      }),
    ]);

    const stats = {
      period: {
        hours,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      totalLogs,
      errorLogs,
      warningLogs,
      successLogs: totalLogs - errorLogs - warningLogs,
      errorRate: totalLogs > 0 ? Math.round((errorLogs / totalLogs) * 100 * 10) / 10 : 0,
    };

    return jsonResponse(createLocalizedResponse(stats, locale));
  }

  return null;
}

