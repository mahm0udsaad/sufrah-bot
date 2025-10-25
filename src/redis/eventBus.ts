import type Redis from 'ioredis';
import baseRedis from './client';

/**
 * Redis-based event bus for real-time dashboard updates
 * Publishes events to restaurant-specific channels
 */

class RedisEventBus {
  private publisher: Redis;
  private subscriber: Redis;
  private handlers: Map<string, Set<(data: any) => void>>;
  private isClosing: boolean;
  private hasClosed: boolean;

  constructor() {
    this.publisher = baseRedis.duplicate();
    this.subscriber = baseRedis.duplicate();
    this.handlers = new Map();
    this.isClosing = false;
    this.hasClosed = false;

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

    this.publisher.on('error', (err) => {
      console.error('❌ Redis event publisher error:', err);
    });

    this.subscriber.on('error', (err) => {
      console.error('❌ Redis event subscriber error:', err);
    });

    // ioredis connects automatically on instantiation; avoid redundant connect calls
    // to prevent "Redis is already connecting" rejection noise
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
    if (this.hasClosed || this.isClosing) {
      return;
    }

    this.isClosing = true;

    const results = await Promise.allSettled([
      this.publisher.quit(),
      this.subscriber.quit(),
    ]);

    results.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('❌ Error closing Redis event bus connection:', result.reason);
      }
    });

    this.handlers.clear();
    this.hasClosed = true;
  }
}

// Singleton instance
export const eventBus = new RedisEventBus();

// Graceful shutdown
process.on('beforeExit', async () => {
  await eventBus.close();
});
