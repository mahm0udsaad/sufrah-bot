import type { TwilioClient, MessageType } from '../types';
import { appendMessageToConversation } from '../state/conversations';
import { ensureWhatsAppAddress, normalizePhoneNumber } from '../utils/phone';

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
    return message;
  } catch (error) {
    console.error('❌ Error sending text message:', error);
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
    return message;
  } catch (error) {
    console.error(
      `❌ Error sending content message${options.logLabel ? ` (${options.logLabel})` : ''}:`,
      error
    );
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
    return message;
  } catch (error) {
    console.error('❌ Error sending interactive message:', error);
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
