import { startWhatsAppSendWorker } from '../redis/whatsappSendQueue';

console.log('🚀 Starting WhatsApp Send Queue Worker...');


// Start the worker
const worker = startWhatsAppSendWorker();

// Log queue metrics every 30 seconds
const metricsInterval = setInterval(async () => {
  try {
    const { getQueueMetrics } = await import('../redis/whatsappSendQueue');
    const metrics = await getQueueMetrics();
    
    console.log('📊 [WhatsAppSendQueue] Metrics:', {
      waiting: metrics.waiting,
      active: metrics.active,
      completed: metrics.completed,
      failed: metrics.failed,
      delayed: metrics.delayed,
      tenantCount: Object.keys(metrics.tenantConcurrency).length,
      tenantConcurrency: metrics.tenantConcurrency,
    });
  } catch (error) {
    console.error('❌ Failed to fetch queue metrics:', error);
  }
}, 30000);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('⚠️ SIGTERM received, shutting down gracefully...');
  clearInterval(metricsInterval);
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('⚠️ SIGINT received, shutting down gracefully...');
  clearInterval(metricsInterval);
  await worker.close();
  process.exit(0);
});

console.log('✅ WhatsApp Send Queue Worker is running');
console.log('📊 Metrics will be logged every 30 seconds');
console.log('🛑 Press Ctrl+C to stop');

