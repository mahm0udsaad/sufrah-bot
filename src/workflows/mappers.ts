import type { StoredConversation, StoredMessage } from '../types';
import { resolveTemplateDisplay } from './templateText';

export function mapConversationToApi(conversation: StoredConversation) {
  return {
    id: conversation.id,
    customer_phone: conversation.customerPhone,
    customer_name: conversation.customerName || '',
    status: conversation.status,
    last_message_at: conversation.lastMessageAt || conversation.createdAt,
    unread_count: conversation.unreadCount,
    is_bot_active: conversation.isBotActive,
  };
}

export function mapMessageToApi(message: StoredMessage) {
  const outgoingType = message.messageType;
  const apiType =
    outgoingType === 'template' || outgoingType === 'interactive'
      ? 'text'
      : outgoingType;
  const resolvedContent =
    message.messageType === 'template'
      ? resolveTemplateDisplay(message.content) ?? message.content
      : message.content;
  return {
    id: message.id,
    conversation_id: message.conversationId,
    from_phone: message.fromPhone,
    to_phone: message.toPhone,
    message_type: apiType,
    content: resolvedContent,
    media_url: message.mediaUrl ?? null,
    timestamp: message.timestamp,
    is_from_customer: message.isFromCustomer,
  };
}
