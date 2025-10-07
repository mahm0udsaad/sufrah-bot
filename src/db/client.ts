import { PrismaClient } from '@prisma/client';

// Singleton pattern for Prisma client
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Graceful shutdown
let prismaDisconnecting = false;
process.on('beforeExit', async () => {
  if (prismaDisconnecting) {
    return;
  }
  prismaDisconnecting = true;
  try {
    await prisma.$disconnect();
  } catch (err) {
    console.error('❌ Error disconnecting Prisma client:', err);
  }
});
