import { prisma } from './client';
import type { RestaurantBot } from '@prisma/client';
import { standardizeWhatsappNumber } from '../utils/phone';

/**
 * Lookup RestaurantBot by WhatsApp "To" number
 * This is the core routing mechanism for multi-tenancy
 */
export async function findRestaurantByWhatsAppNumber(
  whatsappFrom: string
): Promise<(RestaurantBot & { restaurant?: any | null }) | null> {
  const normalized = standardizeWhatsappNumber(whatsappFrom);
  if (!normalized) {
    return null;
  }

  const bot = await (prisma as any).restaurantBot?.findFirst?.({
    where: {
      whatsappNumber: normalized,
      isActive: true,
    },
    include: {
      restaurant: true,
    },
  });

  if (bot) {
    return {
      ...bot,
      restaurantId: bot.restaurantId ?? bot.restaurant?.id ?? bot.id,
      name: bot.name ?? bot.restaurantName ?? bot.restaurant?.name ?? 'Restaurant',
    };
  }

  return null;
}

/**
 * Get restaurant by ID
 */
export async function getRestaurantById(id: string): Promise<RestaurantBot | null> {
  return prisma.restaurantBot.findUnique({
    where: { id },
  });
}

/**
 * Create a new restaurant bot
 */
export async function createRestaurant(data: {
  name: string;
  whatsappFrom: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  restaurantName: string;
  twilioSubaccountSid?: string;
  supportContact?: string;
  paymentLink?: string;
}): Promise<RestaurantBot> {
  return prisma.restaurantBot.create({
    data,
  });
}

/**
 * Update restaurant settings
 */
export async function updateRestaurant(
  id: string,
  data: Partial<Omit<RestaurantBot, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<RestaurantBot> {
  return prisma.restaurantBot.update({
    where: { id },
    data,
  });
}

/**
 * List all active restaurants
 */
export async function listActiveRestaurants(): Promise<RestaurantBot[]> {
  return prisma.restaurantBot.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}
