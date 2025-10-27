#!/usr/bin/env bun
/**
 * Helper script to get the correct Bot ID configuration for dashboard
 * Run with: bun run scripts/getBotConfig.ts <whatsapp_number>
 */

import { prisma } from '../src/db/client';

async function getBotConfig() {
  const whatsappNumber = process.argv[2];
  
  if (!whatsappNumber) {
    console.log('\n❌ Please provide a WhatsApp number');
    console.log('Usage: bun run scripts/getBotConfig.ts <whatsapp_number>');
    console.log('Example: bun run scripts/getBotConfig.ts +966573610338\n');
    process.exit(1);
  }

  try {
    const bot = await prisma.restaurantBot.findFirst({
      where: {
        whatsappNumber: whatsappNumber,
      },
      select: {
        id: true,
        restaurantName: true,
        whatsappNumber: true,
        restaurantId: true,
        isActive: true,
      },
    });

    if (!bot) {
      console.log(`\n❌ No bot found with WhatsApp number: ${whatsappNumber}\n`);
      
      // Show all available bots
      const allBots = await prisma.restaurantBot.findMany({
        select: {
          restaurantName: true,
          whatsappNumber: true,
        },
      });
      
      if (allBots.length > 0) {
        console.log('Available bots:');
        allBots.forEach(b => {
          console.log(`  - ${b.restaurantName}: ${b.whatsappNumber}`);
        });
        console.log('');
      }
      
      process.exit(1);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  Dashboard Configuration for:', bot.restaurantName);
    console.log('═══════════════════════════════════════════════════════════\n');
    
    console.log('✅ Use this Bot ID in your dashboard frontend:\n');
    console.log(`   BOT_ID="${bot.id}"\n`);
    
    console.log('📋 Configuration Details:\n');
    console.log(`   Restaurant Name: ${bot.restaurantName}`);
    console.log(`   Bot ID: ${bot.id}`);
    console.log(`   Restaurant ID: ${bot.restaurantId || 'null'}`);
    console.log(`   WhatsApp: ${bot.whatsappNumber}`);
    console.log(`   Status: ${bot.isActive ? '✅ Active' : '⚠️  Inactive'}\n`);
    
    console.log('🔧 Dashboard API Configuration:\n');
    console.log(`   1. Set X-Restaurant-Id header to: ${bot.id}`);
    console.log(`   2. Use in API URLs: /api/tenants/${bot.id}/overview\n`);
    
    console.log('📝 Example API Call:\n');
    console.log('   curl -X GET \\');
    console.log('     "https://bot.sufrah.sa/api/tenants/' + bot.id + '/overview?currency=SAR" \\');
    console.log('     -H "Authorization: Bearer sufrah_bot_0DJKLldY4IP7dBwEagEywUrC9Z4waN9yi3idlpMQLaM" \\');
    console.log('     -H "X-Restaurant-Id: ' + bot.id + '"\n');
    
    console.log('═══════════════════════════════════════════════════════════\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

getBotConfig();

