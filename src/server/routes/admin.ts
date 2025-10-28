import { jsonResponse } from '../http';
import { prisma } from '../../db/client';
import { standardizeWhatsappNumber } from '../../utils/phone';
import { sendWelcomeBroadcast } from '../../services/notificationFeed';

// Using string statuses to avoid enum import coupling
type RestaurantStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED';
type BotStatus = 'PENDING' | 'ACTIVE' | 'FAILED' | 'VERIFYING';

interface CreateBotRequest {
  name: string;
  restaurantName: string;
  whatsappNumber: string;
  accountSid: string;
  authToken: string;
  subaccountSid?: string;
  senderSid?: string;
  wabaId?: string;
  status?: BotStatus;
  restaurantId?: string;
  supportContact?: string;
  paymentLink?: string;
  maxMessagesPerMin?: number;
  maxMessagesPerDay?: number;
}

interface UpdateBotRequest {
  name?: string;
  restaurantName?: string;
  whatsappNumber?: string;
  accountSid?: string;
  authToken?: string;
  subaccountSid?: string;
  senderSid?: string;
  wabaId?: string;
  status?: BotStatus;
  restaurantId?: string;
  supportContact?: string;
  paymentLink?: string;
  maxMessagesPerMin?: number;
  maxMessagesPerDay?: number;
  isActive?: boolean;
}

export async function handleAdmin(req: Request, url: URL): Promise<Response | null> {
  // Restaurant profile endpoints
  if (url.pathname.startsWith('/api/admin/restaurants')) {
    return handleRestaurantProfileAdmin(req, url);
  }

  // Restaurant bot/sender endpoints
  if (url.pathname.startsWith('/api/admin/bots')) {
    return handleRestaurantBotAdmin(req, url);
  }

  return null;
}

// Restaurant Profile Admin Handlers
async function handleRestaurantProfileAdmin(req: Request, url: URL): Promise<Response | null> {
  // NOTE: In a real app, you'd have proper admin authentication here
  if (req.method === 'GET' && url.pathname === '/api/admin/restaurants') {
    const status = url.searchParams.get('status') as RestaurantStatus | null;
    const whereClause = status ? { status } : {};
    
    const restaurants = await prisma.restaurant.findMany({
      where: whereClause,
      include: {
        bots: true,
      },
    });
    return jsonResponse(restaurants);
  }

  const match = url.pathname.match(/^\/api\/admin\/restaurants\/([^/]+)\/(approve|reject)$/);
  if (match && req.method === 'POST') {
    const [, restaurantId, action] = match;
    const newStatus: RestaurantStatus = action === 'approve' ? 'ACTIVE' : 'REJECTED';
    
    try {
      const updatedRestaurant = await prisma.restaurant.update({
        where: { id: restaurantId },
        data: { status: newStatus }
      });
      return jsonResponse(updatedRestaurant);
    } catch (error) {
      console.error(`❌ Failed to ${action} restaurant ${restaurantId}:`, error);
      return jsonResponse({ error: 'Failed to update restaurant status' }, 500);
    }
  }

  return null;
}

// Restaurant Bot/Sender Admin Handlers
async function handleRestaurantBotAdmin(req: Request, url: URL): Promise<Response | null> {
  // List all bots
  if (req.method === 'GET' && url.pathname === '/api/admin/bots') {
    try {
      const bots = await prisma.restaurantBot.findMany({
        include: {
          restaurant: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      return jsonResponse(bots);
    } catch (error) {
      console.error('❌ Failed to list bots:', error);
      return jsonResponse({ error: 'Failed to list bots' }, 500);
    }
  }

  // Get specific bot
  const getBotMatch = url.pathname.match(/^\/api\/admin\/bots\/([^/]+)$/);
  if (getBotMatch && req.method === 'GET') {
    const [, botId] = getBotMatch;
    try {
      const bot = await prisma.restaurantBot.findUnique({
        where: { id: botId },
        include: {
          restaurant: true,
        },
      });
      if (!bot) {
        return jsonResponse({ error: 'Bot not found' }, 404);
      }
      return jsonResponse(bot);
    } catch (error) {
      console.error(`❌ Failed to get bot ${botId}:`, error);
      return jsonResponse({ error: 'Failed to get bot' }, 500);
    }
  }

  // Create new bot/sender
  if (req.method === 'POST' && url.pathname === '/api/admin/bots') {
    try {
      const body = (await req.json().catch(() => ({}))) as CreateBotRequest;
      const {
        name,
        restaurantName,
        whatsappNumber,
        accountSid,
        authToken,
        subaccountSid,
        senderSid,
        wabaId,
        status,
        restaurantId,
        supportContact,
        paymentLink,
        maxMessagesPerMin,
        maxMessagesPerDay,
      } = body;

      // Validate required fields
      if (!name || !restaurantName || !whatsappNumber || !accountSid || !authToken) {
        return jsonResponse({
          error: 'Missing required fields: name, restaurantName, whatsappNumber, accountSid, authToken',
        }, 400);
      }

      // Standardize WhatsApp number
      const normalizedNumber = standardizeWhatsappNumber(whatsappNumber);
      if (!normalizedNumber) {
        return jsonResponse({ error: 'Invalid WhatsApp number format' }, 400);
      }

      // Check if bot with this number already exists
      const existing = await prisma.restaurantBot.findFirst({
        where: { whatsappNumber: normalizedNumber },
      });
      if (existing) {
        return jsonResponse({
          error: `Bot with WhatsApp number ${normalizedNumber} already exists`,
        }, 409);
      }

      // Create the bot
      const bot = await prisma.restaurantBot.create({
        data: {
          name,
          restaurantName,
          whatsappNumber: normalizedNumber,
          accountSid,
          authToken,
          subaccountSid: subaccountSid || null,
          senderSid: senderSid || null,
          wabaId: wabaId || null,
          status: (status as BotStatus) || 'ACTIVE',
          restaurantId: restaurantId || null,
          supportContact: supportContact || null,
          paymentLink: paymentLink || null,
          maxMessagesPerMin: maxMessagesPerMin || 60,
          maxMessagesPerDay: maxMessagesPerDay || 1000,
          isActive: true,
        },
      });

      console.log(`✅ Created new bot: ${bot.name} (${bot.whatsappNumber})`);

      if (bot.restaurantId) {
        try {
          const result = await sendWelcomeBroadcast({ restaurantId: bot.restaurantId });
          console.log(
            `📣 Sent welcome broadcast for restaurant ${bot.restaurantId}: delivered=${result.delivered}, skipped=${result.skipped}, failed=${result.failed}`
          );
        } catch (error) {
          console.error(
            `❌ Failed to send welcome broadcast for restaurant ${bot.restaurantId}:`,
            error
          );
        }
      }

      return jsonResponse(bot, 201);
    } catch (error) {
      console.error('❌ Failed to create bot:', error);
      return jsonResponse({ error: 'Failed to create bot', details: String(error) }, 500);
    }
  }

  // Update bot
  const updateBotMatch = url.pathname.match(/^\/api\/admin\/bots\/([^/]+)$/);
  if (updateBotMatch && req.method === 'PUT') {
    const [, botId] = updateBotMatch;
    try {
      const body = (await req.json().catch(() => ({}))) as UpdateBotRequest;
      const {
        name,
        restaurantName,
        whatsappNumber,
        accountSid,
        authToken,
        subaccountSid,
        senderSid,
        wabaId,
        status,
        restaurantId,
        supportContact,
        paymentLink,
        maxMessagesPerMin,
        maxMessagesPerDay,
        isActive,
      } = body;

      // Build update data dynamically
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (restaurantName !== undefined) updateData.restaurantName = restaurantName;
      if (whatsappNumber !== undefined) {
        const normalizedNumber = standardizeWhatsappNumber(whatsappNumber);
        if (!normalizedNumber) {
          return jsonResponse({ error: 'Invalid WhatsApp number format' }, 400);
        }
        updateData.whatsappNumber = normalizedNumber;
      }
      if (accountSid !== undefined) updateData.accountSid = accountSid;
      if (authToken !== undefined) updateData.authToken = authToken;
      if (subaccountSid !== undefined) updateData.subaccountSid = subaccountSid;
      if (senderSid !== undefined) updateData.senderSid = senderSid;
      if (wabaId !== undefined) updateData.wabaId = wabaId;
      if (status !== undefined) updateData.status = status;
      if (restaurantId !== undefined) updateData.restaurantId = restaurantId;
      if (supportContact !== undefined) updateData.supportContact = supportContact;
      if (paymentLink !== undefined) updateData.paymentLink = paymentLink;
      if (maxMessagesPerMin !== undefined) updateData.maxMessagesPerMin = maxMessagesPerMin;
      if (maxMessagesPerDay !== undefined) updateData.maxMessagesPerDay = maxMessagesPerDay;
      if (isActive !== undefined) updateData.isActive = isActive;

      const bot = await prisma.restaurantBot.update({
        where: { id: botId },
        data: updateData,
      });

      console.log(`✅ Updated bot: ${bot.name} (${bot.whatsappNumber})`);
      return jsonResponse(bot);
    } catch (error) {
      console.error(`❌ Failed to update bot ${botId}:`, error);
      return jsonResponse({ error: 'Failed to update bot', details: String(error) }, 500);
    }
  }

  // Delete bot
  if (updateBotMatch && req.method === 'DELETE') {
    const [, botId] = updateBotMatch;
    try {
      await prisma.restaurantBot.delete({
        where: { id: botId },
      });
      console.log(`✅ Deleted bot: ${botId}`);
      return jsonResponse({ success: true, message: 'Bot deleted' });
    } catch (error) {
      console.error(`❌ Failed to delete bot ${botId}:`, error);
      return jsonResponse({ error: 'Failed to delete bot', details: String(error) }, 500);
    }
  }

  return null;
}
