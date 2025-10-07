import { prisma } from './client';
import type { Conversation } from '@prisma/client';
import { ConversationStatus } from '@prisma/client';

/**
 * Find or create a conversation for a restaurant + customer pair
 */
export async function findOrCreateConversation(
  restaurantId: string,
  customerWa: string,
  customerName?: string
): Promise<Conversation> {
  const existing = await prisma.conversation.findUnique({
    where: {
      restaurantId_customerWa: {
        restaurantId,
        customerWa,
      },
    },
  });

  if (existing) {
    // Update customer name if provided and different
    if (customerName && customerName !== existing.customerName) {
      return prisma.conversation.update({
        where: { id: existing.id },
        data: { customerName, updatedAt: new Date() },
      });
    }
    return existing;
  }

  return prisma.conversation.create({
    data: {
      restaurantId,
      customerWa,
      customerName,
      status: ConversationStatus.active,
      lastMessageAt: new Date(),
      unreadCount: 0,
      isBotActive: true,
    },
  });
}

/**
 * Get conversation by ID
 */
export async function getConversationById(id: string): Promise<Conversation | null> {
  return prisma.conversation.findUnique({
    where: { id },
  });
}

/**
 * Update conversation data
 */
export async function updateConversation(
  id: string,
  data: Partial<Omit<Conversation, 'id' | 'restaurantId' | 'customerWa' | 'createdAt'>>
): Promise<Conversation> {
  return prisma.conversation.update({
    where: { id },
    data: { ...data, updatedAt: new Date() },
  });
}

/**
 * List conversations for a restaurant
 */
export async function listConversations(
  restaurantId: string,
  options: {
    status?: ConversationStatus;
    limit?: number;
    offset?: number;
  } = {}
): Promise<Conversation[]> {
  const { status, limit = 50, offset = 0 } = options;

  return prisma.conversation.findMany({
    where: {
      restaurantId,
      ...(status && { status }),
    },
    orderBy: { lastMessageAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

/**
 * Mark conversation as read
 */
export async function markConversationRead(id: string): Promise<Conversation> {
  return prisma.conversation.update({
    where: { id },
    data: { unreadCount: 0 },
  });
}

/**
 * Increment unread count
 */
export async function incrementUnreadCount(id: string): Promise<Conversation> {
  return prisma.conversation.update({
    where: { id },
    data: { unreadCount: { increment: 1 } },
  });
}
