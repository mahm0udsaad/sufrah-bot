/**
 * Simple in-memory metrics for observability
 * Can be extended to export Prometheus metrics
 */

interface MetricData {
  webhooksReceived: number;
  webhooksProcessed: number;
  webhooksFailed: number;
  messagesReceived: number;
  messagesSent: number;
  messagesFailed: number;
  queueDepth: number;
  avgProcessingTimeMs: number;
  errorRate: number;
  uptime: number;
}

class MetricsCollector {
  private metrics: MetricData = {
    webhooksReceived: 0,
    webhooksProcessed: 0,
    webhooksFailed: 0,
    messagesReceived: 0,
    messagesSent: 0,
    messagesFailed: 0,
    queueDepth: 0,
    avgProcessingTimeMs: 0,
    errorRate: 0,
    uptime: 0,
  };

  private processingTimes: number[] = [];
  private startTime: number = Date.now();

  incrementWebhooksReceived(): void {
    this.metrics.webhooksReceived++;
  }

  incrementWebhooksProcessed(): void {
    this.metrics.webhooksProcessed++;
  }

  incrementWebhooksFailed(): void {
    this.metrics.webhooksFailed++;
  }

  incrementMessagesReceived(): void {
    this.metrics.messagesReceived++;
  }

  incrementMessagesSent(): void {
    this.metrics.messagesSent++;
  }

  incrementMessagesFailed(): void {
    this.metrics.messagesFailed++;
  }

  recordProcessingTime(timeMs: number): void {
    this.processingTimes.push(timeMs);
    // Keep only last 1000 measurements
    if (this.processingTimes.length > 1000) {
      this.processingTimes.shift();
    }
    this.calculateAverageProcessingTime();
  }

  setQueueDepth(depth: number): void {
    this.metrics.queueDepth = depth;
  }

  private calculateAverageProcessingTime(): void {
    if (this.processingTimes.length === 0) {
      this.metrics.avgProcessingTimeMs = 0;
      return;
    }
    const sum = this.processingTimes.reduce((a, b) => a + b, 0);
    this.metrics.avgProcessingTimeMs = Math.round(sum / this.processingTimes.length);
  }

  private calculateErrorRate(): void {
    const total = this.metrics.webhooksProcessed + this.metrics.webhooksFailed;
    if (total === 0) {
      this.metrics.errorRate = 0;
      return;
    }
    this.metrics.errorRate = Number((this.metrics.webhooksFailed / total).toFixed(4));
  }

  getMetrics(): MetricData {
    this.metrics.uptime = Math.floor((Date.now() - this.startTime) / 1000);
    this.calculateErrorRate();
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {
      webhooksReceived: 0,
      webhooksProcessed: 0,
      webhooksFailed: 0,
      messagesReceived: 0,
      messagesSent: 0,
      messagesFailed: 0,
      queueDepth: 0,
      avgProcessingTimeMs: 0,
      errorRate: 0,
      uptime: 0,
    };
    this.processingTimes = [];
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    const m = this.getMetrics();
    return `
# HELP whatsapp_webhooks_received_total Total number of webhooks received
# TYPE whatsapp_webhooks_received_total counter
whatsapp_webhooks_received_total ${m.webhooksReceived}

# HELP whatsapp_webhooks_processed_total Total number of webhooks processed successfully
# TYPE whatsapp_webhooks_processed_total counter
whatsapp_webhooks_processed_total ${m.webhooksProcessed}

# HELP whatsapp_webhooks_failed_total Total number of webhooks that failed processing
# TYPE whatsapp_webhooks_failed_total counter
whatsapp_webhooks_failed_total ${m.webhooksFailed}

# HELP whatsapp_messages_received_total Total number of inbound messages
# TYPE whatsapp_messages_received_total counter
whatsapp_messages_received_total ${m.messagesReceived}

# HELP whatsapp_messages_sent_total Total number of outbound messages sent
# TYPE whatsapp_messages_sent_total counter
whatsapp_messages_sent_total ${m.messagesSent}

# HELP whatsapp_messages_failed_total Total number of outbound messages that failed
# TYPE whatsapp_messages_failed_total counter
whatsapp_messages_failed_total ${m.messagesFailed}

# HELP whatsapp_queue_depth Current depth of the outbound message queue
# TYPE whatsapp_queue_depth gauge
whatsapp_queue_depth ${m.queueDepth}

# HELP whatsapp_avg_processing_time_ms Average webhook processing time in milliseconds
# TYPE whatsapp_avg_processing_time_ms gauge
whatsapp_avg_processing_time_ms ${m.avgProcessingTimeMs}

# HELP whatsapp_error_rate Error rate for webhook processing
# TYPE whatsapp_error_rate gauge
whatsapp_error_rate ${m.errorRate}

# HELP whatsapp_uptime_seconds Uptime in seconds
# TYPE whatsapp_uptime_seconds counter
whatsapp_uptime_seconds ${m.uptime}
`.trim();
  }
}

export const metrics = new MetricsCollector();

