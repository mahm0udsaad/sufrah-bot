import type { MessageType } from '../types';
import { appendMessageToConversation, getOrCreateConversation, setConversationData } from '../state/conversations';
import { normalizePhoneNumber } from '../utils/phone';
import { TWILIO_WHATSAPP_FROM } from '../config';

export function recordInboundMessage(
  phoneNumber: string,
  content: string,
  messageType: string,
  options: { mediaUrl?: string | null; profileName?: string; recipientPhone?: string; botEnabled?: boolean } = {}
) {
  const conversationId = normalizePhoneNumber(phoneNumber);
  const recipient = options.recipientPhone ? normalizePhoneNumber(options.recipientPhone) : normalizePhoneNumber(TWILIO_WHATSAPP_FROM);
  const conversation = getOrCreateConversation(conversationId, options.profileName);

  setConversationData(conversation.id, {
    isBotActive: options.botEnabled ?? conversation.isBotActive,
    status: 'active',
  });

  const supportedTypes: MessageType[] = ['text', 'image', 'document', 'audio', 'template', 'interactive'];
  const safeType = supportedTypes.includes(messageType as MessageType) ? (messageType as MessageType) : 'text';

  appendMessageToConversation(conversation.id, {
    fromPhone: conversationId,
    toPhone: recipient,
    messageType: safeType,
    content,
    mediaUrl: options.mediaUrl ?? null,
    isFromCustomer: true,
  });
}
