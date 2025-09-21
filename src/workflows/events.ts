import type { StoredConversation, StoredMessage } from '../types';

export type BroadcastEvent =
  | { type: 'message.created'; data: Record<string, any> }
  | { type: 'conversation.updated'; data: Record<string, any> }
  | { type: 'bot.status'; data: Record<string, any> };

const websocketClients = new Set<Bun.ServerWebSocket<any>>();

export function registerWebsocketClient(ws: Bun.ServerWebSocket<any>) {
  websocketClients.add(ws);
}

export function removeWebsocketClient(ws: Bun.ServerWebSocket<any>) {
  websocketClients.delete(ws);
}

export function broadcast(event: BroadcastEvent) {
  const payload = JSON.stringify(event);
  for (const client of websocketClients) {
    try {
      client.send(payload);
    } catch (error) {
      console.error('❌ Error broadcasting websocket event:', error);
    }
  }
}

export function broadcastConversation(conversation: StoredConversation, mapper: (conv: StoredConversation) => any) {
  broadcast({ type: 'conversation.updated', data: mapper(conversation) });
}

export function broadcastMessage(message: StoredMessage, mapper: (msg: StoredMessage) => any) {
  broadcast({ type: 'message.created', data: mapper(message) });
}

export function notifyBotStatus(enabled: boolean) {
  broadcast({ type: 'bot.status', data: { enabled } });
}

export function getWebsocketClients() {
  return websocketClients;
}
