import { prisma } from './client';
import type { RestaurantBot } from '@prisma/client';

/**
 * Lookup RestaurantBot by WhatsApp "To" number
 * This is the core routing mechanism for multi-tenancy
 */
export async function findRestaurantByWhatsAppNumber(
  whatsappFrom: string
): Promise<RestaurantBot | null> {
  return prisma.restaurantBot.findUnique({
    where: { whatsappFrom, isActive: true },
  });
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

