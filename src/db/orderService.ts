import { prisma } from './client';
import type { Order, Prisma } from '@prisma/client';
import { OrderStatus } from '@prisma/client';

function toOrderMeta(items: any[], extras: Record<string, any> = {}): Prisma.InputJsonValue {
  const safeItems = Array.isArray(items) ? items : [];

  const normalized = safeItems.map((item) => {
    const base = typeof item === 'object' && item !== null ? item : {};
    const meta = typeof base.meta === 'object' && base.meta !== null ? base.meta : {};

    const productId =
      typeof meta.productId === 'string'
        ? meta.productId
        : typeof base.productId === 'string'
        ? base.productId
        : typeof base.id === 'string'
        ? base.id
        : undefined;

    const addonsRaw = Array.isArray(meta.addons)
      ? meta.addons
      : Array.isArray(base.addons)
      ? base.addons
      : [];
    const addons = addonsRaw
      .map((addon: any) => {
        if (!addon || typeof addon !== 'object') {
          return null;
        }
        const addonId =
          typeof addon.productAddonId === 'string'
            ? addon.productAddonId
            : typeof addon.addonId === 'string'
            ? addon.addonId
            : typeof addon.id === 'string'
            ? addon.id
            : undefined;
        if (!addonId) {
          return null;
        }
        const qty =
          typeof addon.quantity === 'number'
            ? addon.quantity
            : typeof addon.qty === 'number'
            ? addon.qty
            : 1;
        return {
          productAddonId: addonId,
          quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
        };
      })
      .filter(
        (addon: { productAddonId: string; quantity: number } | null): addon is { productAddonId: string; quantity: number } =>
          !!addon
      );

    return {
      ...base,
      meta: {
        ...meta,
        productId,
        addons,
      },
    };
  });

  return {
    ...extras,
    items: normalized,
  } as Prisma.InputJsonValue;
}

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
      restaurantId: data.restaurantId,
      conversationId: data.conversationId,
      orderReference: data.orderReference,
      orderType: data.orderType,
      totalCents: Math.round((data.total || 0) * 100),
      currency: data.currency ?? 'SAR',
      deliveryAddress: data.deliveryAddress,
      deliveryLat: data.deliveryLat,
      deliveryLng: data.deliveryLng,
      branchId: data.branchId,
      branchName: data.branchName,
      branchAddress: data.branchAddress,
      paymentMethod: null,
      status: OrderStatus.DRAFT,
      statusStage: 0,
      meta: toOrderMeta(data.items, {
        orderType: data.orderType,
        currency: data.currency ?? 'SAR',
      }),
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
  status: OrderStatus,
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
      status: OrderStatus.CONFIRMED,
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
      status: OrderStatus.DELIVERED,
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
      status: OrderStatus.DELIVERED,
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
    status?: OrderStatus;
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
