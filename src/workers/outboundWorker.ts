/**
 * Standalone outbound message worker
 * Processes queued messages and sends them via Twilio
 * 
 * Run this in a separate process:
 * bun run src/workers/outboundWorker.ts
 */

import { startOutboundWorker } from '../redis/queue';

console.log('🚀 Starting outbound message worker...');

const worker = startOutboundWorker();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('⏹️  SIGTERM received, shutting down gracefully...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('⏹️  SIGINT received, shutting down gracefully...');
  await worker.close();
  process.exit(0);
});

console.log('✅ Outbound worker is running');
console.log('📬 Waiting for jobs...');

