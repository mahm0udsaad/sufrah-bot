import type { TwilioClient, MessageType } from '../types';
import { appendMessageToConversation } from '../state/conversations';
import { ensureWhatsAppAddress, normalizePhoneNumber } from '../utils/phone';
import { findRestaurantByWhatsAppNumber } from '../db/restaurantService';
import { findOrCreateConversation, updateConversation } from '../db/conversationService';
import { createOutboundMessage } from '../db/messageService';

async function persistOutboundMessageToDb(params: {
  from: string;
  to: string;
  waSid: string | null | undefined;
  messageType: string;
  content: string;
  mediaUrl?: string | null;
  metadata?: any;
}): Promise<void> {
  const { from, to, waSid, messageType, content, mediaUrl, metadata } = params;
  if (!waSid) return;

  try {
    const bot = await findRestaurantByWhatsAppNumber(from);
    const restaurantId = bot?.restaurantId;
    if (!restaurantId) {
      return;
    }

    const normalizedTo = normalizePhoneNumber(to);
    const normalizedFrom = normalizePhoneNumber(from);
    if (!normalizedTo || !normalizedFrom) {
      return;
    }

    const conversation = await findOrCreateConversation(restaurantId, normalizedTo);
    await createOutboundMessage({
      conversationId: conversation.id,
      restaurantId,
      waSid,
      fromPhone: normalizedFrom,
      toPhone: normalizedTo,
      messageType,
      content,
      mediaUrl: mediaUrl ?? undefined,
      metadata,
    });

    await updateConversation(conversation.id, {
      lastMessageAt: new Date(),
    });
  } catch (error) {
    console.error('❌ Failed to persist outbound message to DB:', error);
  }
}

export async function sendTextMessage(
  client: TwilioClient,
  from: string,
  to: string,
  text: string
): Promise<any> {
  const fromAddress = ensureWhatsAppAddress(from);
  const toAddress = ensureWhatsAppAddress(to);
  const normalizedRecipient = normalizePhoneNumber(to);
  const normalizedSender = normalizePhoneNumber(from);

  try {
    console.log('📤 [Twilio] sendTextMessage');
    console.log('   from:', fromAddress);
    console.log('   to  :', toAddress);
    console.log('   body:', text?.slice(0, 80));
    const message = await client.messages.create({
      from: fromAddress,
      to: toAddress,
      body: text,
    });
    console.log('✅ Text message sent:', message.sid);
    appendMessageToConversation(normalizedRecipient, {
      fromPhone: normalizedSender,
      toPhone: normalizedRecipient,
      messageType: 'text',
      content: text,
      isFromCustomer: false,
    });
    await persistOutboundMessageToDb({
      from,
      to,
      waSid: message.sid,
      messageType: 'text',
      content: text,
      metadata: { source: 'bot', channel: 'twilio' },
    });
    return message;
  } catch (error) {
    console.error('❌ Error sending text message:', error);
    try {
      // Some Twilio errors carry additional fields
      const anyErr: any = error as any;
      if (anyErr?.code || anyErr?.moreInfo || anyErr?.status) {
        console.error('   code   :', anyErr.code);
        console.error('   status :', anyErr.status);
        console.error('   moreInfo:', anyErr.moreInfo);
      }
    } catch {}
    throw error;
  }
}

export async function sendContentMessage(
  client: TwilioClient,
  from: string,
  to: string,
  contentSid: string,
  options: {
    variables?: Record<string, string>;
    logLabel?: string;
  } = {}
): Promise<any> {
  const fromAddress = ensureWhatsAppAddress(from);
  const toAddress = ensureWhatsAppAddress(to);
  const normalizedRecipient = normalizePhoneNumber(to);
  const normalizedSender = normalizePhoneNumber(from);

  try {
    console.log('📤 [Twilio] sendContentMessage');
    console.log('   from:', fromAddress);
    console.log('   to  :', toAddress);
    console.log('   contentSid:', contentSid);
    const message = await client.messages.create({
      from: fromAddress,
      to: toAddress,
      contentSid,
      ...(options.variables
        ? { contentVariables: JSON.stringify(options.variables) }
        : {}),
    });
    if (options.logLabel) {
      console.log(`✅ ${options.logLabel}:`, message.sid);
    }
    appendMessageToConversation(normalizedRecipient, {
      fromPhone: normalizedSender,
      toPhone: normalizedRecipient,
      messageType: 'template',
      content: `content:${contentSid}`,
      isFromCustomer: false,
    });
    await persistOutboundMessageToDb({
      from,
      to,
      waSid: message.sid,
      messageType: 'template',
      content: `content:${contentSid}`,
      metadata: {
        source: 'bot',
        channel: 'twilio',
        contentSid,
        variables: options.variables ?? undefined,
        logLabel: options.logLabel ?? undefined,
      },
    });
    return message;
  } catch (error) {
    console.error(
      `❌ Error sending content message${options.logLabel ? ` (${options.logLabel})` : ''}:`,
      error
    );
    try {
      const anyErr: any = error as any;
      if (anyErr?.code || anyErr?.moreInfo || anyErr?.status) {
        console.error('   code   :', anyErr.code);
        console.error('   status :', anyErr.status);
        console.error('   moreInfo:', anyErr.moreInfo);
      }
    } catch {}
    throw error;
  }
}

export async function sendInteractiveMessage(
  client: TwilioClient,
  from: string,
  to: string,
  interactive: any
): Promise<any> {
  const fromAddress = ensureWhatsAppAddress(from);
  const toAddress = ensureWhatsAppAddress(to);
  const normalizedRecipient = normalizePhoneNumber(to);
  const normalizedSender = normalizePhoneNumber(from);

  try {
    console.log('📤 [Twilio] sendInteractiveMessage');
    console.log('   from:', fromAddress);
    console.log('   to  :', toAddress);
    console.log('   payload keys:', Object.keys(interactive || {}));
    const messagePayload: any = {
      from: fromAddress,
      to: toAddress,
    };

    // Twilio expects the interactive object to be stringified for WhatsApp
    if (interactive.type === 'list') {
      messagePayload.body = JSON.stringify({
        type: 'list',
        ...interactive,
      });
      messagePayload.contentType = 'application/json';
    } else if (interactive.type === 'button') {
      messagePayload.body = JSON.stringify({
        type: 'button',
        ...interactive,
      });
      messagePayload.contentType = 'application/json';
    } else {
      // Fallback to direct body
      messagePayload.body = JSON.stringify(interactive);
      messagePayload.contentType = 'application/json';
    }

    const message = await client.messages.create(messagePayload);
    console.log('✅ Interactive message sent:', message.sid);
    appendMessageToConversation(normalizedRecipient, {
      fromPhone: normalizedSender,
      toPhone: normalizedRecipient,
      messageType: 'interactive',
      content: JSON.stringify(interactive),
      isFromCustomer: false,
    });
    await persistOutboundMessageToDb({
      from,
      to,
      waSid: message.sid,
      messageType: 'interactive',
      content: JSON.stringify(interactive),
      metadata: { source: 'bot', channel: 'twilio' },
    });
    return message;
  } catch (error) {
    console.error('❌ Error sending interactive message:', error);
    throw error;
  }
}

export async function sendMediaMessage(
  client: TwilioClient,
  from: string,
  to: string,
  options: {
    mediaUrls: string[];
    caption?: string;
    messageType?: MessageType;
  }
): Promise<{ message: any; messageType: Exclude<MessageType, 'text' | 'template' | 'interactive'> }> {
  if (!options.mediaUrls.length) {
    throw new Error('mediaUrls array must include at least one URL');
  }

  const fromAddress = ensureWhatsAppAddress(from);
  const toAddress = ensureWhatsAppAddress(to);
  const normalizedRecipient = normalizePhoneNumber(to);
  const normalizedSender = normalizePhoneNumber(from);
  const caption = options.caption?.trim();
  const messageType =
    pickMediaMessageType(options.messageType) ?? inferMessageType(options.mediaUrls[0]);

  try {
    const message = await client.messages.create({
      from: fromAddress,
      to: toAddress,
      ...(caption ? { body: caption } : {}),
      mediaUrl: options.mediaUrls,
    });
    console.log('✅ Media message sent:', message.sid);
    appendMessageToConversation(normalizedRecipient, {
      fromPhone: normalizedSender,
      toPhone: normalizedRecipient,
      messageType,
      content: caption || `[media:${messageType}]`,
      mediaUrl: options.mediaUrls[0] ?? null,
      isFromCustomer: false,
    });
    await persistOutboundMessageToDb({
      from,
      to,
      waSid: message.sid,
      messageType,
      content: caption || `[media:${messageType}]`,
      mediaUrl: options.mediaUrls[0] ?? null,
      metadata: { source: 'bot', channel: 'twilio' },
    });
    return { message, messageType };
  } catch (error) {
    console.error('❌ Error sending media message:', error);
    throw error;
  }
}

export function appendOutboundMessage(
  to: string,
  messageType: MessageType,
  content: string,
  options: { mediaUrl?: string | null; from?: string }
) {
  const normalizedRecipient = normalizePhoneNumber(to);
  const normalizedSender = normalizePhoneNumber(options.from ?? to);
  appendMessageToConversation(normalizedRecipient, {
    fromPhone: normalizedSender,
    toPhone: normalizedRecipient,
    messageType,
    content,
    mediaUrl: options.mediaUrl ?? null,
    isFromCustomer: false,
  });
}

function inferMessageType(url: string): Exclude<MessageType, 'text' | 'template' | 'interactive'> {
  const normalized = url.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|heic|heif|bmp)$/.test(normalized)) {
    return 'image';
  }
  if (/(\.mp4|\.mov|\.m4v|\.webm)$/.test(normalized)) {
    return 'video';
  }
  if (/(\.mp3|\.wav|\.m4a|\.aac|\.ogg|\.opus)$/.test(normalized)) {
    return 'audio';
  }
  return 'document';
}

function pickMediaMessageType(type?: MessageType): Exclude<MessageType, 'text' | 'template' | 'interactive'> | undefined {
  if (!type) return undefined;
  if (type === 'image' || type === 'document' || type === 'audio' || type === 'video') {
    return type;
  }
  return undefined;
}
