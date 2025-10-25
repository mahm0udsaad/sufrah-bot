/**
 * Helper script to check RestaurantBot table and prepare insert/update for +966508034010
 */

import { prisma } from '../src/db/client';

const TARGET_WHATSAPP = '+966508034010';
const TARGET_WHATSAPP_ALT = '966508034010'; // without plus

async function main() {
  console.log('🔍 Checking RestaurantBot table for', TARGET_WHATSAPP);
  console.log('');

  // Check if bot exists (with or without +)
  const existingBot = await prisma.restaurantBot.findFirst({
    where: {
      OR: [
        { whatsappNumber: TARGET_WHATSAPP },
        { whatsappNumber: TARGET_WHATSAPP_ALT },
      ],
    },
    include: {
      restaurant: true,
    },
  });

  if (existingBot) {
    console.log('✅ Found existing RestaurantBot:');
    console.log('   ID:', existingBot.id);
    console.log('   Name:', existingBot.name);
    console.log('   Restaurant Name:', existingBot.restaurantName);
    console.log('   WhatsApp Number:', existingBot.whatsappNumber);
    console.log('   Twilio Account SID:', existingBot.accountSid);
    console.log('   Is Active:', existingBot.isActive);
    console.log('   Status:', existingBot.status);
    console.log('');
    
    if (!existingBot.isActive) {
      console.log('⚠️  Bot exists but is NOT active. Activating it...');
      await prisma.restaurantBot.update({
        where: { id: existingBot.id },
        data: { isActive: true, status: 'ACTIVE' },
      });
      console.log('✅ Bot activated successfully!');
    } else if (existingBot.status !== 'ACTIVE') {
      console.log('⚠️  Bot is active but status is not ACTIVE. Updating status...');
      await prisma.restaurantBot.update({
        where: { id: existingBot.id },
        data: { status: 'ACTIVE' },
      });
      console.log('✅ Bot status updated to ACTIVE!');
    } else {
      console.log('✅ Bot is already active and ready to receive messages.');
    }
    
    return;
  }

  console.log('❌ No RestaurantBot found for', TARGET_WHATSAPP);
  console.log('');
  console.log('📋 You need to insert a RestaurantBot record.');
  console.log('');
  console.log('Required information:');
  console.log('  - Restaurant name');
  console.log('  - Twilio Account SID');
  console.log('  - Twilio Auth Token');
  console.log('  - (Optional) Twilio Subaccount SID');
  console.log('  - (Optional) Restaurant Profile ID (if linking to existing Restaurant)');
  console.log('');
  console.log('Environment variables to check:');
  console.log('  TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID || '(not set)');
  console.log('  TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? '***' + process.env.TWILIO_AUTH_TOKEN.slice(-4) : '(not set)');
  console.log('  TWILIO_WHATSAPP_FROM:', process.env.TWILIO_WHATSAPP_FROM || '(not set)');
  console.log('');

  // Check if there are ANY RestaurantBot records
  const allBots = await prisma.restaurantBot.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
  });

  if (allBots.length > 0) {
    console.log('📋 Existing RestaurantBot records (for reference):');
    allBots.forEach((bot, idx) => {
      console.log(`  ${idx + 1}. ${bot.name} - ${bot.whatsappNumber} (${bot.isActive ? 'Active' : 'Inactive'})`);
    });
    console.log('');
    console.log('💡 You can use one of these as a template for credentials.');
  }

  // Prepare insert SQL
  console.log('');
  console.log('📝 SQL to insert new RestaurantBot (update the values in <brackets>):');
  console.log('');
  console.log(`INSERT INTO "RestaurantBot" (
  id,
  name,
  "restaurantName",
  "whatsappFrom",
  "twilioAccountSid",
  "twilioAuthToken",
  "isActive",
  "status",
  "createdAt",
  "updatedAt"
) VALUES (
  gen_random_uuid(),
  '<Bot Name>',  -- e.g., 'Ocean Restaurant Bot'
  '<Restaurant Name>',  -- e.g., 'Ocean Restaurant'
  '${TARGET_WHATSAPP}',
  '<Your Twilio Account SID>',  -- e.g., 'AC...'
  '<Your Twilio Auth Token>',  -- e.g., 'your_auth_token'
  true,
  'ACTIVE',
  NOW(),
  NOW()
);`);
  console.log('');
  console.log('Or use Prisma Studio at http://localhost:5555 (run: bunx prisma studio)');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });

