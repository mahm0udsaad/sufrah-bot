import { prisma } from './client';
import type { WebhookLog } from '@prisma/client';

/**
 * Log a webhook request for audit trail
 */
export async function logWebhookRequest(data: {
  restaurantId?: string;
  requestId: string;
  method: string;
  path: string;
  headers?: any;
  body?: any;
  statusCode?: number;
  errorMessage?: string;
}): Promise<WebhookLog> {
  return prisma.webhookLog.create({
    data,
  });
}

/**
 * Get recent webhook logs for a restaurant
 */
export async function getRecentWebhookLogs(
  restaurantId: string,
  limit: number = 100
): Promise<WebhookLog[]> {
  return prisma.webhookLog.findMany({
    where: { restaurantId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Cleanup old webhook logs (data retention policy)
 */
export async function cleanupOldWebhookLogs(daysToKeep: number = 30): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const result = await prisma.webhookLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
    },
  });

  return result.count;
}

