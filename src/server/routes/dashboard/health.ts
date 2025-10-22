/**
 * Health and observability API
 * Provides system health checks and service status
 */

import { jsonResponse } from '../../http';
import { BOT_API_KEY } from '../../../config';
import { prisma } from '../../../db/client';
import { redis as redisClient } from '../../../redis/client';
import { getLocaleFromRequest, createLocalizedResponse } from '../../../services/i18n';

type AuthResult = { ok: boolean; isPublic?: boolean; isAdmin?: boolean; error?: string };

function authenticate(req: Request): AuthResult {
  const apiKeyHeader = req.headers.get('x-api-key') || '';

  // Health endpoint can be public or authenticated
  // If no auth, return limited info. With API key, return detailed metrics
  if (BOT_API_KEY && apiKeyHeader && apiKeyHeader === BOT_API_KEY) {
    return { ok: true, isAdmin: true };
  }

  return { ok: true, isPublic: true };
}

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<{ healthy: boolean; latency: number | null; error?: string }> {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    return {
      healthy: true,
      latency: Date.now() - start,
    };
  } catch (error: any) {
    return {
      healthy: false,
      latency: null,
      error: error.message,
    };
  }
}

/**
 * Check Redis connectivity
 */
async function checkRedis(): Promise<{ healthy: boolean; latency: number | null; error?: string }> {
  try {
    const start = Date.now();
    await redisClient.ping();
    return {
      healthy: true,
      latency: Date.now() - start,
    };
  } catch (error: any) {
    return {
      healthy: false,
      latency: null,
      error: error.message,
    };
  }
}

/**
 * Get queue metrics
 */
async function getQueueMetrics() {
  try {
    const [whatsappSendLen, outboundLen] = await Promise.all([
      redisClient.llen('whatsapp-send'),
      redisClient.llen('whatsapp-outbound'),
    ]);

    return {
      whatsappSendQueue: {
        length: whatsappSendLen || 0,
        healthy: (whatsappSendLen || 0) < 1000, // Alert if queue exceeds 1000
      },
      outboundQueue: {
        length: outboundLen || 0,
        healthy: (outboundLen || 0) < 1000,
      },
    };
  } catch (error: any) {
    return {
      whatsappSendQueue: {
        length: 0,
        healthy: false,
        error: error.message,
      },
      outboundQueue: {
        length: 0,
        healthy: false,
        error: error.message,
      },
    };
  }
}

/**
 * Handle GET /api/health
 * Returns system health status
 */
export async function handleHealthApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/health - basic health check
  if (url.pathname === '/api/health' && req.method === 'GET') {
    const auth = authenticate(req);
    const locale = getLocaleFromRequest(req);

    const [dbHealth, redisHealth] = await Promise.all([
      checkDatabase(),
      checkRedis(),
    ]);

    const isHealthy = dbHealth.healthy && redisHealth.healthy;

    // Public response (limited info)
    if (auth.isPublic) {
      return jsonResponse(
        createLocalizedResponse(
          {
            status: isHealthy ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            services: {
              database: dbHealth.healthy ? 'ok' : 'error',
              redis: redisHealth.healthy ? 'ok' : 'error',
            },
          },
          locale
        ),
        isHealthy ? 200 : 503
      );
    }

    // Admin response (detailed metrics)
    const queueMetrics = await getQueueMetrics();

    // Get recent webhook stats
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [totalWebhooks, errorWebhooks] = await Promise.all([
      prisma.webhookLog.count({ where: { createdAt: { gte: oneHourAgo } } }),
      prisma.webhookLog.count({
        where: {
          createdAt: { gte: oneHourAgo },
          statusCode: { gte: 400 },
        },
      }),
    ]);

    const webhookErrorRate = totalWebhooks > 0 ? (errorWebhooks / totalWebhooks) * 100 : 0;

    return jsonResponse(
      createLocalizedResponse(
        {
          status: isHealthy ? 'healthy' : 'degraded',
          timestamp: new Date().toISOString(),
          services: {
            database: {
              healthy: dbHealth.healthy,
              latency: dbHealth.latency,
              error: dbHealth.error,
            },
            redis: {
              healthy: redisHealth.healthy,
              latency: redisHealth.latency,
              error: redisHealth.error,
            },
            queues: queueMetrics,
            webhooks: {
              totalLast1h: totalWebhooks,
              errorsLast1h: errorWebhooks,
              errorRate: Math.round(webhookErrorRate * 10) / 10,
              healthy: webhookErrorRate < 10, // Alert if >10% error rate
            },
          },
          uptime: process.uptime(),
          memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            unit: 'MB',
          },
        },
        locale
      ),
      isHealthy ? 200 : 503
    );
  }

  // GET /api/health/ready - readiness check
  if (url.pathname === '/api/health/ready' && req.method === 'GET') {
    const [dbHealth, redisHealth] = await Promise.all([
      checkDatabase(),
      checkRedis(),
    ]);

    const isReady = dbHealth.healthy && redisHealth.healthy;

    return jsonResponse(
      {
        ready: isReady,
        timestamp: new Date().toISOString(),
      },
      isReady ? 200 : 503
    );
  }

  // GET /api/health/live - liveness check
  if (url.pathname === '/api/health/live' && req.method === 'GET') {
    return jsonResponse(
      {
        alive: true,
        timestamp: new Date().toISOString(),
      },
      200
    );
  }

  return null;
}

