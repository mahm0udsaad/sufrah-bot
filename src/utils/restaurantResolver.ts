/**
 * Restaurant ID Resolution Utility
 * 
 * Handles the mapping between RestaurantBot IDs and Restaurant IDs (RestaurantProfile).
 * 
 * In the database:
 * - RestaurantBot.id: The bot's unique identifier (used in API URLs and headers)
 * - RestaurantBot.restaurantId: References Restaurant.id (the actual merchant profile)
 * - Restaurant.id: The RestaurantProfile ID (used for orders, messages, usage tracking, etc.)
 * 
 * This resolver ensures that when a RestaurantBot ID (or a Restaurant ID)
 * is provided, we use the correct Restaurant ID for database queries.
 */

import { prisma } from '../db/client';

interface ResolvedRestaurant {
  botId: string;
  restaurantId: string;
  botName: string;
  exists: boolean;
}

/**
 * Resolves a RestaurantBot ID to the actual Restaurant ID
 * 
 * @param botId - The RestaurantBot.id from URL params or headers
 * @returns Object containing both IDs and metadata, or null if not found
 */
export async function resolveRestaurantId(botOrRestaurantId: string): Promise<ResolvedRestaurant | null> {
  // First try: treat header as RestaurantBot.id (tenant id)
  const bot = await prisma.restaurantBot.findUnique({
    where: { id: botOrRestaurantId },
    select: {
      id: true,
      name: true,
      restaurantId: true,
    },
  });

  if (bot) {
    // If restaurantId is null, fall back to using the bot ID itself
    // (for backwards compatibility with bots created before the Restaurant link was added)
    const actualRestaurantId = bot.restaurantId || bot.id;

    return {
      botId: bot.id,
      restaurantId: actualRestaurantId,
      botName: bot.name,
      exists: true,
    };
  }

  // Second try: treat header as Restaurant.id (merchant/restaurant profile id)
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: botOrRestaurantId },
    select: {
      id: true,
      name: true,
    },
  });

  if (!restaurant) {
    return null;
  }

  // Find any associated active bot to enrich response (optional)
  const associatedBot = await prisma.restaurantBot.findFirst({
    where: { restaurantId: restaurant.id, isActive: true },
    select: { id: true, name: true },
  });

  return {
    botId: associatedBot?.id || restaurant.id,
    restaurantId: restaurant.id,
    botName: associatedBot?.name || restaurant.name,
    exists: true,
  };
}

/**
 * Resolves a RestaurantBot ID to just the Restaurant ID string
 * 
 * @param botId - The RestaurantBot.id from URL params or headers
 * @returns The Restaurant ID, or null if not found
 */
export async function getRestaurantIdFromBot(botId: string): Promise<string | null> {
  const resolved = await resolveRestaurantId(botId);
  return resolved ? resolved.restaurantId : null;
}

/**
 * Validates that a RestaurantBot exists and returns its Restaurant ID
 * Throws an error if not found
 * 
 * @param botId - The RestaurantBot.id from URL params or headers
 * @returns The Restaurant ID
 * @throws Error if bot not found
 */
export async function requireRestaurantId(botId: string): Promise<string> {
  const restaurantId = await getRestaurantIdFromBot(botId);
  
  if (!restaurantId) {
    throw new Error(`Restaurant bot not found: ${botId}`);
  }
  
  return restaurantId;
}

