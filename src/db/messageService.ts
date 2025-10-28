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

  const { fromPhone, toPhone, metadata, mediaUrl, ...rest } = data;
  const mergedMeta = {
    ...(metadata ?? {}),
    fromPhone,
    toPhone,
  };
  const cleanedMeta = Object.fromEntries(
    Object.entries(mergedMeta).filter(([, value]) => value !== undefined && value !== null)
  );

  return prisma.message.create({
    data: {
      ...rest,
      mediaUrl: mediaUrl ?? null,
      metadata: Object.keys(cleanedMeta).length ? cleanedMeta : undefined,
      direction: 'IN',
    },
  });
}

/**
 * Create an outbound message with idempotency
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
}): Promise<Message | null> {
  // Idempotency check - if waSid exists, check if message already exists
  if (data.waSid && (await messageExists(data.waSid))) {
    console.log(`⚠️ Duplicate outbound message detected: ${data.waSid}`);
    // Return the existing message instead of throwing an error
    const existingMessage = await prisma.message.findUnique({
      where: { waSid: data.waSid },
    });
    return existingMessage;
  }

  const { fromPhone, toPhone, metadata, mediaUrl, ...rest } = data;
  const mergedMeta = {
    ...(metadata ?? {}),
    fromPhone,
    toPhone,
  };
  const cleanedMeta = Object.fromEntries(
    Object.entries(mergedMeta).filter(([, value]) => value !== undefined && value !== null)
  );

  try {
    return await prisma.message.create({
      data: {
        ...rest,
        mediaUrl: mediaUrl ?? null,
        metadata: Object.keys(cleanedMeta).length ? cleanedMeta : undefined,
        direction: 'OUT',
      },
    });
  } catch (error: any) {
    // If we get a unique constraint violation on waSid, it means the message was created
    // by another process between our check and this create attempt. Fetch and return it.
    if (error.code === 'P2002' && error.meta?.target?.includes('wa_sid') && data.waSid) {
      console.log(`⚠️ Duplicate outbound message created by another process: ${data.waSid}`);
      const existingMessage = await prisma.message.findUnique({
        where: { waSid: data.waSid },
      });
      return existingMessage;
    }
    // For other errors, rethrow
    throw error;
  }
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
    order?: 'asc' | 'desc';
  } = {}
): Promise<Message[]> {
  const { limit = 100, offset = 0, before, order = 'asc' } = options;

  return prisma.message.findMany({
    where: {
      conversationId,
      ...(before && { createdAt: { lt: before } }),
    },
    orderBy: { createdAt: order },
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
