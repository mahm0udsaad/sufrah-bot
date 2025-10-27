import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkKaramBot() {
  try {
    const bots = await prisma.restaurantBot.findMany({
      where: {
        OR: [
          { whatsappNumber: '+966573610338' },
          { whatsappNumber: '966573610338' },
          { whatsappNumber: 'whatsapp:+966573610338' }
        ]
      },
      select: {
        id: true,
        restaurantName: true,
        whatsappNumber: true,
        accountSid: true,
        authToken: true,
        restaurantId: true,
        isActive: true,
        status: true,
        senderSid: true,
        wabaId: true
      }
    });

    console.log('=== Database Records for +966573610338 ===');
    console.log(JSON.stringify(bots, null, 2));
    
    if (bots.length === 0) {
      console.log('\n⚠️  No matching records found in database');
    } else {
      console.log('\n✅ Found', bots.length, 'record(s)');
    }
  } catch (error) {
    console.error('Error querying database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkKaramBot();

