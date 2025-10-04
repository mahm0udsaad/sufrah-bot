import Redis from 'ioredis';
import { REDIS_URL } from '../config';

/**
 * Redis-based event bus for real-time dashboard updates
 * Publishes events to restaurant-specific channels
 */

class RedisEventBus {
  private publisher: Redis;
  private subscriber: Redis;
  private handlers: Map<string, Set<(data: any) => void>>;

  constructor() {
    this.publisher = new Redis(REDIS_URL);
    this.subscriber = new Redis(REDIS_URL);
    this.handlers = new Map();

    this.subscriber.on('message', (channel, message) => {
      const callbacks = this.handlers.get(channel);
      if (callbacks) {
        try {
          const data = JSON.parse(message);
          callbacks.forEach((cb) => cb(data));
        } catch (err) {
          console.error('❌ Error parsing event message:', err);
        }
      }
    });

    this.publisher.on('connect', () => {
      console.log('✅ Redis event publisher connected');
    });

    this.subscriber.on('connect', () => {
      console.log('✅ Redis event subscriber connected');
    });
  }

  /**
   * Publish a message event to a restaurant channel
   */
  async publishMessage(restaurantId: string, message: any): Promise<void> {
    const channel = `ws:restaurant:${restaurantId}:messages`;
    await this.publisher.publish(channel, JSON.stringify(message));
  }

  /**
   * Publish an order event to a restaurant channel
   */
  async publishOrder(restaurantId: string, order: any): Promise<void> {
    const channel = `ws:restaurant:${restaurantId}:orders`;
    await this.publisher.publish(channel, JSON.stringify(order));
  }

  /**
   * Publish a conversation event to a restaurant channel
   */
  async publishConversation(restaurantId: string, conversation: any): Promise<void> {
    const channel = `ws:restaurant:${restaurantId}:conversations`;
    await this.publisher.publish(channel, JSON.stringify(conversation));
  }

  /**
   * Subscribe to a restaurant's messages channel
   */
  async subscribeToMessages(
    restaurantId: string,
    callback: (data: any) => void
  ): Promise<void> {
    const channel = `ws:restaurant:${restaurantId}:messages`;
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
      await this.subscriber.subscribe(channel);
    }
    this.handlers.get(channel)!.add(callback);
  }

  /**
   * Subscribe to a restaurant's orders channel
   */
  async subscribeToOrders(
    restaurantId: string,
    callback: (data: any) => void
  ): Promise<void> {
    const channel = `ws:restaurant:${restaurantId}:orders`;
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
      await this.subscriber.subscribe(channel);
    }
    this.handlers.get(channel)!.add(callback);
  }

  /**
   * Subscribe to a restaurant's conversations channel
   */
  async subscribeToConversations(
    restaurantId: string,
    callback: (data: any) => void
  ): Promise<void> {
    const channel = `ws:restaurant:${restaurantId}:conversations`;
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
      await this.subscriber.subscribe(channel);
    }
    this.handlers.get(channel)!.add(callback);
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(restaurantId: string, type: 'messages' | 'orders' | 'conversations'): Promise<void> {
    const channel = `ws:restaurant:${restaurantId}:${type}`;
    await this.subscriber.unsubscribe(channel);
    this.handlers.delete(channel);
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await this.publisher.quit();
    await this.subscriber.quit();
  }
}

// Singleton instance
export const eventBus = new RedisEventBus();

// Graceful shutdown
process.on('beforeExit', async () => {
  await eventBus.close();
});

