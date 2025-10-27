/**
 * Fix WhatsApp number mismatches between RestaurantBot and RestaurantProfile
 * This ensures the bot sends FROM the correct Twilio-registered number
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixWhatsAppMismatches() {
  console.log('🔧 Fixing WhatsApp number mismatches...');
  console.log('='.repeat(80));

  try {
    // Get all bots with a restaurant profile
    const bots = await prisma.restaurantBot.findMany({
      where: {
        restaurantId: { not: null },
        isActive: true,
      },
      include: {
        restaurant: true,
      },
    });

    let fixedCount = 0;

    for (const bot of bots) {
      if (!bot.restaurant) continue;

      const botWhatsApp = bot.whatsappNumber;
      const restaurantWhatsApp = bot.restaurant.whatsappNumber;

      if (restaurantWhatsApp !== botWhatsApp) {
        console.log(`\n📱 ${bot.restaurantName || bot.name}`);
        console.log(`   Bot WhatsApp:        ${botWhatsApp}`);
        console.log(`   Restaurant WhatsApp: ${restaurantWhatsApp || 'NOT SET'}`);
        console.log(`   🔧 Updating Restaurant Profile to match Bot...`);

        await prisma.restaurant.update({
          where: { id: bot.restaurantId! },
          data: {
            whatsappNumber: botWhatsApp,
          },
        });

        console.log(`   ✅ Updated to ${botWhatsApp}`);
        fixedCount++;
      } else {
        console.log(`\n✅ ${bot.restaurantName || bot.name} - Already matching (${botWhatsApp})`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\n🎉 Fixed ${fixedCount} mismatch(es)\n`);
  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixWhatsAppMismatches();

