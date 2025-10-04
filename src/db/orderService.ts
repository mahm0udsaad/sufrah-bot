import { prisma } from './client';
import type { Order } from '@prisma/client';

/**
 * Create a new order
 */
export async function createOrder(data: {
  restaurantId: string;
  conversationId: string;
  orderReference: string;
  orderType?: string;
  items: any[];
  total: number;
  currency?: string;
  deliveryAddress?: string;
  deliveryLat?: string;
  deliveryLng?: string;
  branchId?: string;
  branchName?: string;
  branchAddress?: string;
}): Promise<Order> {
  return prisma.order.create({
    data: {
      ...data,
      status: 'DRAFT',
      statusStage: 0,
    },
  });
}

/**
 * Get order by reference
 */
export async function getOrderByReference(orderReference: string): Promise<Order | null> {
  return prisma.order.findUnique({
    where: { orderReference },
  });
}

/**
 * Update order status
 */
export async function updateOrderStatus(
  id: string,
  status: string,
  statusStage?: number
): Promise<Order> {
  return prisma.order.update({
    where: { id },
    data: {
      status,
      ...(statusStage !== undefined && { statusStage }),
      updatedAt: new Date(),
    },
  });
}

/**
 * Update order with payment method
 */
export async function updateOrderPayment(
  id: string,
  paymentMethod: string
): Promise<Order> {
  return prisma.order.update({
    where: { id },
    data: {
      paymentMethod,
      status: 'CONFIRMED',
      updatedAt: new Date(),
    },
  });
}

/**
 * Set order rating
 */
export async function setOrderRating(
  id: string,
  rating: number,
  ratingComment?: string
): Promise<Order> {
  return prisma.order.update({
    where: { id },
    data: {
      rating,
      ratingComment,
      ratedAt: new Date(),
      status: 'RATED',
      updatedAt: new Date(),
    },
  });
}

/**
 * Mark rating asked
 */
export async function markRatingAsked(id: string): Promise<Order> {
  return prisma.order.update({
    where: { id },
    data: {
      ratingAskedAt: new Date(),
    },
  });
}

/**
 * Find orders ready for delivery (status = DELIVERED and no rating asked)
 */
export async function findOrdersReadyForRating(limit: number = 10): Promise<Order[]> {
  return prisma.order.findMany({
    where: {
      status: 'DELIVERED',
      ratingAskedAt: null,
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });
}

/**
 * Get orders for a conversation
 */
export async function getConversationOrders(
  conversationId: string,
  limit: number = 10
): Promise<Order[]> {
  return prisma.order.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Get orders for a restaurant
 */
export async function getRestaurantOrders(
  restaurantId: string,
  options: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<Order[]> {
  const { status, limit = 50, offset = 0 } = options;

  return prisma.order.findMany({
    where: {
      restaurantId,
      ...(status && { status }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

