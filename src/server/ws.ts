import { mapConversationToApi } from '../workflows/mappers';
import { getConversations } from '../state/conversations';
import { registerWebsocketClient, removeWebsocketClient, broadcast } from '../workflows/events';
import { eventBus } from '../redis/eventBus';
import { prisma } from '../db/client';

// Track which restaurants each WebSocket is subscribed to
const wsSubscriptions = new Map<Bun.ServerWebSocket<any>, Set<string>>();
let isRedisListenerSetup = false;

/**
 * Setup Redis event bus listeners (only once globally)
 * Forwards Redis pub/sub events to all connected WebSocket clients
 */
async function setupRedisEventBusListeners() {
  if (isRedisListenerSetup) return;
  isRedisListenerSetup = true;

  console.log('🔌 Setting up Redis → WebSocket bridge...');

  // Get all restaurants and subscribe to their channels
  const restaurants = await prisma.restaurant.findMany({
    select: { id: true },
  });

  for (const restaurant of restaurants) {
    // Subscribe to messages
    await eventBus.subscribeToMessages(restaurant.id, (data) => {
      console.log(`📨 Redis event received for restaurant ${restaurant.id}:`, data.type);

      // Map Redis event to WebSocket event format
      // Redis: { type: 'message.*', message: {...}, conversation?: {...} }
      // WebSocket: { type: 'message.created', data: Message }
      const type = typeof data.type === 'string' ? data.type : '';
      if (type.startsWith('message.') && data.message) {
        broadcast({ type: 'message.created', data: data.message });

        // Also broadcast conversation update if included
        if (data.conversation) {
          broadcast({ type: 'conversation.updated', data: data.conversation });
        }
      }
    });

    // Subscribe to conversations
    await eventBus.subscribeToConversations(restaurant.id, (data) => {
      console.log(`💬 Redis conversation event received for restaurant ${restaurant.id}:`, data.type);
      broadcast({ type: 'conversation.updated', data });
    });

    // Subscribe to orders
    await eventBus.subscribeToOrders(restaurant.id, (data) => {
      console.log(`🛒 Redis order event received for restaurant ${restaurant.id}:`, data.type);
      broadcast({ type: 'order.updated', data });
    });
  }

  console.log(`✅ Redis → WebSocket bridge active for ${restaurants.length} restaurants`);
}

export const wsHandlers = {
  async open(ws: Bun.ServerWebSocket<any>) {
    registerWebsocketClient(ws);
    wsSubscriptions.set(ws, new Set());

    // Setup Redis listeners on first WebSocket connection
    if (!isRedisListenerSetup) {
      try {
        await setupRedisEventBusListeners();
      } catch (error) {
        console.error('❌ Failed to setup Redis event bus listeners:', error);
      }
    }

    ws.send(JSON.stringify({ type: 'connection', data: 'connected' }));
    ws.send(JSON.stringify({ type: 'conversation.bootstrap', data: getConversations().map(mapConversationToApi) }));
  },
  close(ws: Bun.ServerWebSocket<any>) {
    removeWebsocketClient(ws);
    wsSubscriptions.delete(ws);
  },
  message(ws: Bun.ServerWebSocket<any>, message: string | Uint8Array) {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    if (text === 'ping') ws.send('pong');
  },
};

