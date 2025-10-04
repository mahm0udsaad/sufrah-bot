import { prisma } from './client';
import type { Message } from '@prisma/client';

/**
 * Check if a message with this waSid already exists (idempotency check)
 */
export async function messageExists(waSid: string): Promise<boolean> {
  if (!waSid) return false;
  const count = await prisma.message.count({
    where: { waSid },
  });
  return count > 0;
}

/**
 * Create an inbound message with idempotency
 */
export async function createInboundMessage(data: {
  conversationId: string;
  restaurantId: string;
  waSid?: string;
  fromPhone: string;
  toPhone: string;
  messageType: string;
  content: string;
  mediaUrl?: string;
  metadata?: any;
}): Promise<Message | null> {
  // Idempotency check
  if (data.waSid && (await messageExists(data.waSid))) {
    console.log(`⚠️ Duplicate message detected: ${data.waSid}`);
    return null;
  }

  return prisma.message.create({
    data: {
      ...data,
      direction: 'IN',
    },
  });
}

/**
 * Create an outbound message
 */
export async function createOutboundMessage(data: {
  conversationId: string;
  restaurantId: string;
  waSid?: string;
  fromPhone: string;
  toPhone: string;
  messageType: string;
  content: string;
  mediaUrl?: string;
  metadata?: any;
}): Promise<Message> {
  return prisma.message.create({
    data: {
      ...data,
      direction: 'OUT',
    },
  });
}

/**
 * Update message with Twilio SID after sending
 */
export async function updateMessageWithSid(
  id: string,
  waSid: string
): Promise<Message> {
  return prisma.message.update({
    where: { id },
    data: { waSid },
  });
}

/**
 * List messages for a conversation
 */
export async function listMessages(
  conversationId: string,
  options: {
    limit?: number;
    offset?: number;
    before?: Date;
  } = {}
): Promise<Message[]> {
  const { limit = 100, offset = 0, before } = options;

  return prisma.message.findMany({
    where: {
      conversationId,
      ...(before && { createdAt: { lt: before } }),
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    skip: offset,
  });
}

/**
 * Get recent messages for a restaurant (for dashboard feed)
 */
export async function getRecentMessages(
  restaurantId: string,
  limit: number = 50
): Promise<Message[]> {
  return prisma.message.findMany({
    where: { restaurantId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

