/**
 * Diagnose all restaurant bots and their configurations
 * Check for mismatches between DB and Twilio
 */

import { PrismaClient } from '@prisma/client';
import { TwilioClientManager } from '../src/twilio/clientManager';

const prisma = new PrismaClient();

async function diagnoseAllBots() {
  console.log('🔍 Diagnosing all restaurant bots...');
  console.log('='.repeat(80));

  try {
    // Get all restaurant bots
    const bots = await prisma.restaurantBot.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        restaurantName: true,
        whatsappNumber: true,
        accountSid: true,
        authToken: true,
        restaurantId: true,
        status: true,
        senderSid: true,
      },
    });

    console.log(`\n✅ Found ${bots.length} active bots\n`);

    for (const bot of bots) {
      console.log('─'.repeat(80));
      console.log(`\n📱 Bot: ${bot.restaurantName || bot.name}`);
      console.log(`   ID: ${bot.id}`);
      console.log(`   Restaurant ID: ${bot.restaurantId}`);
      console.log(`   WhatsApp Number: ${bot.whatsappNumber}`);
      console.log(`   Account SID: ${bot.accountSid}`);
      console.log(`   Sender SID: ${bot.senderSid || 'NOT SET'}`);
      console.log(`   Status: ${bot.status}`);

      // Check if restaurant has a profile
      if (bot.restaurantId) {
        const restaurant = await prisma.restaurant.findUnique({
          where: { id: bot.restaurantId },
          select: {
            id: true,
            name: true,
            whatsappNumber: true,
            externalMerchantId: true,
          },
        });

        if (restaurant) {
          console.log(`\n   🏪 Restaurant Profile:`);
          console.log(`      Name: ${restaurant.name}`);
          console.log(`      WhatsApp: ${restaurant.whatsappNumber || 'NOT SET'}`);
          console.log(`      Merchant ID: ${restaurant.externalMerchantId || 'NOT SET'}`);

          if (restaurant.whatsappNumber && restaurant.whatsappNumber !== bot.whatsappNumber) {
            console.log(`      ⚠️  MISMATCH: Restaurant whatsappNumber (${restaurant.whatsappNumber}) != Bot whatsappNumber (${bot.whatsappNumber})`);
          }
        } else {
          console.log(`\n   ❌ Restaurant profile NOT FOUND`);
        }
      }

      // Try to get Twilio client
      try {
        const clientManager = new TwilioClientManager();
        const twilioClient = await clientManager.getClient(bot.restaurantId || bot.id);
        
        if (twilioClient) {
          console.log(`\n   ✅ Twilio client loaded successfully`);
          // Verify the client is using the right account
          const accountSid = (twilioClient as any).accountSid || (twilioClient as any).username;
          console.log(`      Using Account SID: ${accountSid}`);
          
          if (accountSid !== bot.accountSid) {
            console.log(`      ⚠️  MISMATCH: Client SID (${accountSid}) != Bot SID (${bot.accountSid})`);
          }
        } else {
          console.log(`\n   ❌ Twilio client NOT AVAILABLE`);
        }
      } catch (error) {
        console.log(`\n   ❌ Error loading Twilio client: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Check Twilio sender status
      if (bot.accountSid && bot.authToken) {
        try {
          const response = await fetch(
            `https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp`,
            {
              headers: {
                Authorization: `Basic ${Buffer.from(`${bot.accountSid}:${bot.authToken}`).toString('base64')}`,
              },
            }
          );

          if (response.ok) {
            const data = await response.json();
            const sender = data.senders?.find((s: any) => 
              s.sender_id === `whatsapp:${bot.whatsappNumber}` || 
              s.sender_id === bot.whatsappNumber
            );

            if (sender) {
              console.log(`\n   📡 Twilio Sender Status:`);
              console.log(`      Status: ${sender.status}`);
              console.log(`      Webhook: ${sender.webhook?.callback_url || 'NOT SET'}`);
              
              if (sender.status === 'OFFLINE') {
                console.log(`      ⚠️  Sender is OFFLINE - this will cause send failures!`);
              }
              
              const expectedWebhook = 'https://bot.sufrah.sa/webhook';
              if (sender.webhook?.callback_url !== expectedWebhook) {
                console.log(`      ⚠️  Webhook mismatch! Expected: ${expectedWebhook}`);
              }
            } else {
              console.log(`\n   ❌ Sender NOT FOUND in Twilio for ${bot.whatsappNumber}`);
            }
          }
        } catch (error) {
          console.log(`\n   ⚠️  Could not verify Twilio sender: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Diagnosis complete\n');
  } catch (error) {
    console.error('❌ Diagnosis failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

diagnoseAllBots();

