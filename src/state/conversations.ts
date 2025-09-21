import type { MessageType, StoredConversation, StoredMessage } from '../types';
import { normalizePhoneNumber } from '../utils/phone';

const conversations = new Map<string, StoredConversation>();
const messagesByConversation = new Map<string, StoredMessage[]>();
const messageListeners = new Set<(message: StoredMessage) => void>();
const conversationListeners = new Set<(conversation: StoredConversation) => void>();

export function getOrCreateConversation(phone: string, customerName?: string): StoredConversation {
  const id = normalizePhoneNumber(phone);
  const nowIso = new Date().toISOString();
  let conversation = conversations.get(id);
  if (!conversation) {
    conversation = {
      id,
      customerPhone: id,
      customerName,
      status: 'active',
      lastMessageAt: nowIso,
      unreadCount: 0,
      isBotActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    conversations.set(id, conversation);
    conversationListeners.forEach((listener) => listener(conversation!));
  } else {
    if (customerName && customerName !== conversation.customerName) {
      conversation.customerName = customerName;
      conversation.updatedAt = nowIso;
      conversationListeners.forEach((listener) => listener(conversation!));
    }
  }
  return conversation;
}

export function setConversationData(
  conversationId: string,
  update: Partial<StoredConversation>
): StoredConversation | undefined {
  const id = normalizePhoneNumber(conversationId);
  const conversation = conversations.get(id);
  if (!conversation) return undefined;

  let changed = false;
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if ((conversation as any)[key] !== value) {
      (conversation as any)[key] = value;
      changed = true;
    }
  }

  if (changed) {
    conversation.updatedAt = new Date().toISOString();
    conversationListeners.forEach((listener) => listener(conversation!));
  }

  return conversation;
}

export function getConversationById(conversationId: string): StoredConversation | undefined {
  return conversations.get(normalizePhoneNumber(conversationId));
}

export function getConversations(): StoredConversation[] {
  return Array.from(conversations.values()).sort((a, b) => {
    const aTime = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const bTime = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    return bTime - aTime;
  });
}

export function getConversationMessages(conversationId: string): StoredMessage[] {
  return messagesByConversation.get(normalizePhoneNumber(conversationId)) ?? [];
}

export function appendMessageToConversation(
  conversationId: string,
  payload: Omit<StoredMessage, 'id' | 'timestamp' | 'conversationId'> & { timestamp?: string }
): StoredMessage {
  const normalizedId = normalizePhoneNumber(conversationId);
  const conversation = getOrCreateConversation(normalizedId);
  const message: StoredMessage = {
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2),
    conversationId: normalizedId,
    fromPhone: normalizePhoneNumber(payload.fromPhone),
    toPhone: normalizePhoneNumber(payload.toPhone),
    messageType: payload.messageType,
    content: payload.content,
    mediaUrl: payload.mediaUrl ?? null,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    isFromCustomer: payload.isFromCustomer,
  };

  const messages = messagesByConversation.get(normalizedId) ?? [];
  messages.push(message);
  messagesByConversation.set(normalizedId, messages);

  const updated: Partial<StoredConversation> = {
    lastMessageAt: message.timestamp,
    unreadCount: message.isFromCustomer ? conversation.unreadCount + 1 : 0,
  };

  setConversationData(normalizedId, updated);
  messageListeners.forEach((listener) => listener(message));

  return message;
}

export function markConversationRead(conversationId: string): void {
  setConversationData(conversationId, { unreadCount: 0 });
}

export function onMessageAppended(listener: (message: StoredMessage) => void): () => void {
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}

export function onConversationUpdated(listener: (conversation: StoredConversation) => void): () => void {
  conversationListeners.add(listener);
  return () => conversationListeners.delete(listener);
}

export function getConversationsMap() {
  return conversations;
}

export function getMessagesMap() {
  return messagesByConversation;
}

export function resetConversationStores(): void {
  conversations.clear();
  messagesByConversation.clear();
}
