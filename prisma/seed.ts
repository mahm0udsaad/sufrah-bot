import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create a demo restaurant bot
  const restaurant = await prisma.restaurantBot.upsert({
    where: { whatsappFrom: 'whatsapp:+14155238886' },
    update: {},
    create: {
      name: 'Demo Restaurant Bot',
      whatsappFrom: 'whatsapp:+14155238886',
      twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || 'your_auth_token_here',
      restaurantName: 'مطعم سفرة التجريبي',
      supportContact: '+966-500-000000',
      paymentLink: 'https://example.com/pay',
      isActive: true,
    },
  });

  console.log(`✅ Created restaurant: ${restaurant.name} (${restaurant.id})`);
  console.log(`   WhatsApp: ${restaurant.whatsappFrom}`);

  console.log('\n🎉 Seeding completed!');
  console.log('\nNext steps:');
  console.log('1. Update the Twilio credentials in the database or environment variables');
  console.log('2. Configure your Twilio webhook to point to: http://your-domain/whatsapp/webhook');
  console.log('3. Start the bot: bun start');
  console.log('4. Start the worker: bun run src/workers/outboundWorker.ts');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
