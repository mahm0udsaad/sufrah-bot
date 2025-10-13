import twilio from 'twilio';
import { PrismaClient } from '@prisma/client';
import { TWILIO_MASTER_SID, TWILIO_MASTER_AUTH, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } from '../config';

const prisma = new PrismaClient();

export class TwilioClientManager {
  private clients: Map<string, twilio.Twilio> = new Map();
  private globalClient: twilio.Twilio | null = null;

  private getGlobalClient(): twilio.Twilio | null {
    if (this.globalClient) return this.globalClient;
    const sid = TWILIO_MASTER_SID || TWILIO_ACCOUNT_SID;
    const auth = TWILIO_MASTER_AUTH || TWILIO_AUTH_TOKEN;
    if (!sid || !auth) return null;
    this.globalClient = twilio(sid, auth);
    return this.globalClient;
  }

  async getClient(restaurantId: string): Promise<twilio.Twilio | null> {
    if (this.clients.has(restaurantId)) {
      return this.clients.get(restaurantId)!;
    }

    try {
      // Prefer credentials from RestaurantBot
      const bot = await (prisma as any).restaurantBot?.findFirst?.({
        where: { restaurantId },
        select: {
          accountSid: true,
          authToken: true,
        },
      });

      let accountSid: string | undefined;
      let authToken: string | undefined;

      if (bot && bot.accountSid && bot.authToken) {
        accountSid = bot.accountSid;
        authToken = bot.authToken;
      } else {
        const restaurant = await prisma.restaurant.findUnique({
          where: { id: restaurantId },
          select: {
            twilioAccountSid: true,
            twilioAuthToken: true,
          },
        });
        if (restaurant) {
          accountSid = restaurant.twilioAccountSid ?? undefined;
          authToken = restaurant.twilioAuthToken ?? undefined;
        }
      }

      if (!accountSid || !authToken) {
        const fallback = this.getGlobalClient();
        if (fallback) {
          console.warn(`⚠️ Twilio credentials not found for restaurant ${restaurantId}. Falling back to global credentials.`);
          this.clients.set(restaurantId, fallback);
          return fallback;
        }
        console.error(`❌ Twilio credentials not found for restaurant ${restaurantId} and no global credentials configured`);
        return null;
      }

      const client = twilio(accountSid, authToken);
      this.clients.set(restaurantId, client);
      return client;
    } catch (error) {
      console.error(
        `❌ Failed to retrieve restaurant or create Twilio client for restaurant ${restaurantId}:`,
        error
      );
      return null;
    }
  }
}
