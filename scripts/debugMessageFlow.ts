/**
 * Debug message flow to see exactly what happens when bot processes a message
 * This will show the FROM number being used and catch any errors
 */

import { PrismaClient } from '@prisma/client';
import { processMessage, resolveRestaurantContext } from '../src/handlers/processMessage';
import { TwilioClientManager } from '../src/twilio/clientManager';

const prisma = new PrismaClient();

async function debugMessageFlow() {
  console.log('🔍 Debugging message flow for rashad restaurant');
  console.log('='.repeat(80));

  // Simulate incoming message to rashad (+966508034010)
  const customerPhone = '+20 1157337829'; // From the Twilio log
  const restaurantWhatsApp = '+966508034010'; // rashad's number

  console.log(`\n📥 Incoming Message:`);
  console.log(`   From: ${customerPhone}`);
  console.log(`   To:   ${restaurantWhatsApp}`);

  // Step 1: Resolve restaurant context (same as inboundHandler does)
  console.log(`\n🔍 Step 1: Resolving restaurant context...`);
  try {
    const restaurant = await resolveRestaurantContext(customerPhone, restaurantWhatsApp);
    
    if (!restaurant) {
      console.error('   ❌ No restaurant context found');
      return;
    }

    console.log(`   ✅ Restaurant context resolved:`);
    console.log(`      Restaurant ID: ${restaurant.id}`);
    console.log(`      Name: ${restaurant.name}`);
    console.log(`      WhatsApp: ${restaurant.whatsappNumber}`);
    console.log(`      Merchant ID: ${restaurant.externalMerchantId}`);

    // Step 2: Get Twilio client (same as processMessage does)
    console.log(`\n🔍 Step 2: Getting Twilio client...`);
    const clientManager = new TwilioClientManager();
    const twilioClient = await clientManager.getClient(restaurant.id);
    
    if (!twilioClient) {
      console.error('   ❌ Failed to get Twilio client');
      return;
    }

    console.log(`   ✅ Twilio client obtained`);
    const accountSid = (twilioClient as any).accountSid || (twilioClient as any).username;
    console.log(`      Account SID: ${accountSid}`);

    // Step 3: Check what FROM number would be used
    console.log(`\n🔍 Step 3: Checking FROM number for outbound messages...`);
    const fromNumber = restaurant.whatsappNumber || process.env.TWILIO_WHATSAPP_FROM;
    console.log(`   FROM number: ${fromNumber}`);

    // Verify this number exists in Twilio
    console.log(`\n🔍 Step 4: Verifying FROM number in Twilio...`);
    try {
      const bot = await prisma.restaurantBot.findFirst({
        where: { 
          whatsappNumber: fromNumber,
          isActive: true,
        },
        select: {
          accountSid: true,
          authToken: true,
        },
      });

      if (!bot) {
        console.error(`   ❌ No bot found for WhatsApp number ${fromNumber}`);
        return;
      }

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
          s.sender_id === `whatsapp:${fromNumber}` || 
          s.sender_id === fromNumber
        );

        if (sender) {
          console.log(`   ✅ Sender verified in Twilio:`);
          console.log(`      Sender ID: ${sender.sender_id}`);
          console.log(`      Status: ${sender.status}`);
          console.log(`      Webhook: ${sender.webhook?.callback_url || 'NOT SET'}`);

          if (sender.status !== 'ONLINE') {
            console.error(`   ⚠️  WARNING: Sender is ${sender.status} - messages will fail!`);
          }
        } else {
          console.error(`   ❌ Sender NOT FOUND in Twilio for ${fromNumber}`);
          console.log(`   Available senders:`, data.senders?.map((s: any) => s.sender_id));
        }
      }
    } catch (error) {
      console.error(`   ❌ Error verifying sender:`, error);
    }

    // Step 5: Try to send welcome message (with detailed error catching)
    console.log(`\n🔍 Step 5: Testing message send...`);
    try {
      console.log(`   Calling processMessage(${customerPhone}, "مرحبا", "text", ...)...`);
      await processMessage(customerPhone, 'مرحبا', 'text', {
        recipientPhone: restaurantWhatsApp,
        profileName: 'Test User'
      });
      console.log(`   ✅ Message processed successfully!`);
    } catch (error: any) {
      console.error(`   ❌ Error in processMessage:`, error);
      if (error.code) {
        console.error(`      Twilio Error Code: ${error.code}`);
      }
      if (error.message) {
        console.error(`      Error Message: ${error.message}`);
      }
      if (error.status) {
        console.error(`      HTTP Status: ${error.status}`);
      }
      if (error.moreInfo) {
        console.error(`      More Info: ${error.moreInfo}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Debug complete');

  } catch (error) {
    console.error('\n❌ Debug failed:', error);
    console.error('Stack:', (error as Error).stack);
  } finally {
    await prisma.$disconnect();
  }
}

debugMessageFlow();

