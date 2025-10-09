import twilio from 'twilio';
import { prisma } from '../db/client';
import { findOrCreateConversation, updateConversation } from '../db/conversationService';
import { createOutboundMessage } from '../db/messageService';
import {
  createOutboundMessageLog,
  markOutboundMessageFailed,
  markOutboundMessageSent,
  updateOutboundMessageChannel,
} from '../db/outboundMessageService';
import {
  ensureWhatsAppAddress,
  normalizePhoneNumber,
  standardizeWhatsappNumber,
} from '../utils/phone';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  TWILIO_API_KEY,
  TWILIO_API_SECRET,
  TWILIO_CONTENT_AUTH,
  TWILIO_QUICK_REPLAY_SID,
} from '../config';

type TwilioClient = ReturnType<typeof twilio>;

type SendChannel = 'freeform' | 'template';

interface NotifyResult {
  sid: string;
  channel: SendChannel;
}

interface ChannelDecision {
  channel: SendChannel;
  lastInboundAt: Date | null;
}

interface NotifyRestaurantOrderOptions {
  toNumber?: string;
  fromNumber?: string;
}

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
const NEW_ORDER_TEMPLATE_NAME = 'new_order_notification';
const NOTIFICATION_TEMPLATE_NAME = 'restaurant_notification';
const ORDER_NOTIFICATION_WITH_BUTTON = 'sufrah_new_order_alert';
const CONTENT_BASE_URL = 'https://content.twilio.com/v1/Content';

let sharedTwilioClient: TwilioClient | null = null;
let cachedTemplateSid: string | null = null;
let cachedNotificationTemplateSid: string | null = null;
let cachedOrderButtonTemplateSid: string | null = null;
let ensureTemplatePromise: Promise<string> | null = null;
let ensureNotificationTemplatePromise: Promise<string> | null = null;
let ensureOrderButtonTemplatePromise: Promise<string> | null = null;

function getTwilioClient(): TwilioClient {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio credentials are not configured.');
  }
  if (!sharedTwilioClient) {
    sharedTwilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return sharedTwilioClient;
}

function getContentAuthHeader(): string {
  if (TWILIO_API_KEY && TWILIO_API_SECRET) {
    return Buffer.from(`${TWILIO_API_KEY}:${TWILIO_API_SECRET}`).toString('base64');
  }
  if (TWILIO_CONTENT_AUTH) {
    return TWILIO_CONTENT_AUTH;
  }
  throw new Error('Twilio Content API credentials are not configured.');
}

function extractRecords(payload: any): any[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  if (Array.isArray(payload.contents)) {
    return payload.contents;
  }
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  if (Array.isArray(payload.records)) {
    return payload.records;
  }
  if (Array.isArray(payload.items)) {
    return payload.items;
  }
  return [];
}

async function fetchExistingTemplateSid(authHeader: string, templateName: string): Promise<string | null> {
  try {
    const url = new URL(CONTENT_BASE_URL);
    url.searchParams.set('FriendlyName', templateName);
    url.searchParams.set('PageSize', '20');

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`⚠️ Failed to query existing Twilio content (${res.status}): ${text}`);
      return null;
    }

    const json = await res.json();
    const records = extractRecords(json);
    const match = records.find((record: any) => {
      const friendlyName = record?.friendly_name || record?.friendlyName;
      return friendlyName === templateName;
    });

    if (typeof match?.sid === 'string' && match.sid) {
      console.log(
        `♻️ [WhatsAppNotify] Reusing existing Twilio content SID ${match.sid} for ${templateName}.`
      );
      return match.sid;
    }

    console.log(
      `ℹ️ [WhatsAppNotify] No existing Twilio content found for ${templateName}.`
    );
    return null;
  } catch (error) {
    console.error('⚠️ Error fetching existing Twilio content:', error);
    return null;
  }
}

async function createTemplate(authHeader: string, templateName: string, bodyText: string): Promise<string> {
  const payload = {
    friendly_name: templateName,
    language: 'en',
    types: {
      'twilio/text': {
        body: bodyText,
      },
    },
  };

  const res = await fetch(CONTENT_BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authHeader}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 409) {
      console.warn('⚠️ Twilio reported duplicate template. Attempting to reuse existing SID.');
      const existing = await fetchExistingTemplateSid(authHeader, templateName);
      if (existing) {
        return existing;
      }
    }
    throw new Error(`Twilio Content API error ${res.status}: ${text}`);
  }

  const json: any = await res.json();
  const sid = json?.sid;
  if (typeof sid !== 'string' || !sid) {
    throw new Error('Twilio Content API did not return a SID for the new template.');
  }

  console.log(`✅ [WhatsAppNotify] Created Twilio content template ${templateName}: ${sid}`);
  return sid;
}

async function ensureNewOrderTemplateSid(): Promise<string> {
  if (cachedTemplateSid) {
    return cachedTemplateSid;
  }

  if (ensureTemplatePromise) {
    return ensureTemplatePromise;
  }

  ensureTemplatePromise = (async () => {
    const authHeader = getContentAuthHeader();
    const existing = await fetchExistingTemplateSid(authHeader, NEW_ORDER_TEMPLATE_NAME);
    if (existing) {
      cachedTemplateSid = existing;
      return existing;
    }

    const created = await createTemplate(
      authHeader,
      NEW_ORDER_TEMPLATE_NAME,
      'You have a new order on Sufrah! {{order_text}}'
    );
    cachedTemplateSid = created;
    return created;
  })();

  try {
    return await ensureTemplatePromise;
  } finally {
    ensureTemplatePromise = null;
  }
}

async function ensureNotificationTemplateSid(): Promise<string> {
  if (cachedNotificationTemplateSid) {
    return cachedNotificationTemplateSid;
  }

  if (ensureNotificationTemplatePromise) {
    return ensureNotificationTemplatePromise;
  }

  ensureNotificationTemplatePromise = (async () => {
    const authHeader = getContentAuthHeader();
    const existing = await fetchExistingTemplateSid(authHeader, NOTIFICATION_TEMPLATE_NAME);
    if (existing) {
      cachedNotificationTemplateSid = existing;
      return existing;
    }

    const created = await createTemplate(
      authHeader,
      NOTIFICATION_TEMPLATE_NAME,
      '{{message_text}}'
    );
    cachedNotificationTemplateSid = created;
    return created;
  })();

  try {
    return await ensureNotificationTemplatePromise;
  } finally {
    ensureNotificationTemplatePromise = null;
  }
}

async function ensureOrderButtonTemplateSid(): Promise<string> {
  // Prefer explicit provided SID via config env if present
  if (TWILIO_QUICK_REPLAY_SID) {
    return TWILIO_QUICK_REPLAY_SID;
  }

  if (ensureOrderButtonTemplatePromise) {
    return ensureOrderButtonTemplatePromise;
  }

  ensureOrderButtonTemplatePromise = (async () => {
    const authHeader = getContentAuthHeader();
    const existing = await fetchExistingTemplateSid(authHeader, ORDER_NOTIFICATION_WITH_BUTTON);
    if (existing) {
      cachedOrderButtonTemplateSid = existing;
      return existing;
    }

    // Create template with button
    const payload = {
      friendly_name: ORDER_NOTIFICATION_WITH_BUTTON,
      language: 'en',
      types: {
        'twilio/text': {
          body: 'You have a new order made on Sufrah! 🎉',
        },
        'twilio/quick-reply': {
          body: 'You have a new order made on Sufrah! 🎉',
          actions: [
            {
              title: 'View Order Details',
              id: 'view_order',
            },
          ],
        },
      },
    };

    const res = await fetch(CONTENT_BASE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 409) {
        console.warn('⚠️ Twilio reported duplicate template. Attempting to reuse existing SID.');
        const existing = await fetchExistingTemplateSid(authHeader, ORDER_NOTIFICATION_WITH_BUTTON);
        if (existing) {
          cachedOrderButtonTemplateSid = existing;
          return existing;
        }
      }
      throw new Error(`Twilio Content API error ${res.status}: ${text}`);
    }

  const json: any = await res.json();
    const sid = json?.sid;
    if (typeof sid !== 'string' || !sid) {
      throw new Error('Twilio Content API did not return a SID for the new template.');
    }

    console.log(`✅ [WhatsAppNotify] Created button template ${ORDER_NOTIFICATION_WITH_BUTTON}: ${sid}`);
    cachedOrderButtonTemplateSid = sid;
    return sid;
  })();

  try {
    return await ensureOrderButtonTemplatePromise;
  } finally {
    ensureOrderButtonTemplatePromise = null;
  }
}

function isSessionExpiredError(error: unknown): boolean {
  const code = extractTwilioErrorCode(error);
  return code === 63016;
}

function extractTwilioErrorCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const anyError = error as any;
  if (typeof anyError.code === 'number') {
    return anyError.code;
  }
  if (typeof anyError.code === 'string') {
    const parsed = Number(anyError.code);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof anyError.status === 'number' && anyError.status === 63016) {
    return 63016;
  }
  return null;
}

async function sendFreeformMessage(
  client: TwilioClient,
  from: string,
  to: string,
  body: string
) {
  console.log('📝 [WhatsAppNotify] Attempting freeform send via Twilio.', {
    from,
    to,
    bodyPreview: body.slice(0, 120),
  });
  return client.messages.create({
    from,
    to,
    body,
  });
}

async function sendTemplateMessage(
  client: TwilioClient,
  from: string,
  to: string,
  body: string
) {
  const contentSid = await ensureNewOrderTemplateSid();
  console.log('🧾 [WhatsAppNotify] Attempting template send via Twilio.', {
    from,
    to,
    contentSid,
    variables: { order_text: body.slice(0, 120) },
  });
  return client.messages.create({
    from,
    to,
    contentSid,
    contentVariables: JSON.stringify({ order_text: body }),
  });
}

async function getLastInboundMessageTimestamp(conversationId: string): Promise<Date | null> {
  const record = await prisma.message.findFirst({
    where: {
      conversationId,
      direction: 'IN',
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return record?.createdAt ?? null;
}

async function determineChannel(
  restaurantId: string,
  conversationId: string
): Promise<ChannelDecision> {
  const lastInboundAt = await getLastInboundMessageTimestamp(conversationId);
  if (!lastInboundAt) {
    console.log(
      `ℹ️ [WhatsAppNotify] No inbound history for conversation ${conversationId} (restaurant ${restaurantId}); defaulting to template send.`
    );
    return { channel: 'template', lastInboundAt: null };
  }
  const elapsed = Date.now() - lastInboundAt.getTime();
  console.log(
    `📨 [WhatsAppNotify] Last inbound for conversation ${conversationId} (restaurant ${restaurantId}) at ${lastInboundAt.toISOString()} (${Math.round(
      elapsed / 60000
    )} minutes ago).`
  );
  return { channel: elapsed <= SESSION_WINDOW_MS ? 'freeform' : 'template', lastInboundAt };
}

export async function notifyRestaurantOrder(
  restaurantId: string,
  orderText: string,
  options: NotifyRestaurantOrderOptions = {}
): Promise<NotifyResult> {
  if (!restaurantId) {
    throw new Error('restaurantId is required.');
  }
  const trimmedText = orderText?.trim();
  if (!trimmedText) {
    throw new Error('orderText must be a non-empty string.');
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
  });

  if (!restaurant) {
    throw new Error(`Restaurant ${restaurantId} not found.`);
  }

  const fromNumber = options.fromNumber ?? TWILIO_WHATSAPP_FROM;
  if (!fromNumber) {
    throw new Error('No WhatsApp sender number configured.');
  }

  const targetNumber = options.toNumber ?? restaurant.whatsappNumber;
  if (!targetNumber) {
    throw new Error(
      `Restaurant ${restaurantId} does not have a WhatsApp number configured and no override was provided.`
    );
  }

  const standardizedRecipient = standardizeWhatsappNumber(targetNumber);
  if (!standardizedRecipient) {
    const sourceLabel = options.toNumber ? 'override' : 'profile';
    throw new Error(
      `Restaurant ${restaurantId} has an invalid WhatsApp number (${sourceLabel}).`
    );
  }

  const normalizedRecipient = normalizePhoneNumber(standardizedRecipient);
  const normalizedSender = normalizePhoneNumber(fromNumber);

  const conversation = await findOrCreateConversation(
    restaurantId,
    normalizedRecipient,
    restaurant.name || undefined
  );

  const client = getTwilioClient();
  const fromAddress = ensureWhatsAppAddress(fromNumber);
  const toAddress = ensureWhatsAppAddress(standardizedRecipient);

  const channelDecision = await determineChannel(restaurantId, conversation.id);
  let channel = channelDecision.channel;
  let twilioResponse;

  const metadataState: Record<string, any> = {
    request: {
      restaurantId,
      conversationId: conversation.id,
      toPhone: standardizedRecipient,
      fromPhone: fromNumber,
      initialChannel: channel,
      hasOverride: Boolean(options.toNumber),
    },
    sessionWindow: {
      lastInboundAt: channelDecision.lastInboundAt?.toISOString() ?? null,
      within24h: channelDecision.lastInboundAt
        ? Date.now() - channelDecision.lastInboundAt.getTime() <= SESSION_WINDOW_MS
        : false,
    },
  };

  const outboundLog = await createOutboundMessageLog({
    restaurantId,
    conversationId: conversation.id,
    toPhone: standardizedRecipient,
    fromPhone: fromNumber,
    body: trimmedText,
    channel,
    status: 'pending',
    metadata: metadataState,
  });

  let failureLogged = false;

  console.log(
    `🚀 [WhatsAppNotify] Sending new order notification to restaurant ${restaurantId} using channel ${channel}.`,
    {
      recipient: standardizedRecipient,
      sender: fromNumber,
      hasOverride: Boolean(options.toNumber),
    }
  );

  try {
    try {
      if (channel === 'freeform') {
        twilioResponse = await sendFreeformMessage(client, fromAddress, toAddress, trimmedText);
      } else {
        twilioResponse = await sendTemplateMessage(client, fromAddress, toAddress, trimmedText);
      }
    } catch (error) {
      if (channel === 'freeform' && isSessionExpiredError(error)) {
        console.warn(
          '⚠️ [WhatsAppNotify] Freeform send rejected with session timeout (63016). Retrying with template.'
        );
        channel = 'template';
        metadataState.fallback = {
          reason: 'session_window_expired',
          retriedAt: new Date().toISOString(),
        };
        await updateOutboundMessageChannel(outboundLog?.id ?? null, channel, metadataState);
        twilioResponse = await sendTemplateMessage(client, fromAddress, toAddress, trimmedText);
      } else {
        console.error('❌ [WhatsAppNotify] Twilio send failed.', {
          channel,
          restaurantId,
          recipient: standardizedRecipient,
          error,
        });
        metadataState.lastErrorAt = new Date().toISOString();
        await markOutboundMessageFailed(outboundLog?.id ?? null, {
          channel,
          error,
          metadata: metadataState,
        });
        failureLogged = true;
        throw error;
      }
    }

    const successMetadata = {
      ...metadataState,
      result: {
        channel,
        sid: twilioResponse.sid,
        sentAt: new Date().toISOString(),
      },
    };

    await markOutboundMessageSent(outboundLog?.id ?? null, {
      channel,
      waSid: twilioResponse.sid,
      templateSid: channel === 'template' ? (cachedTemplateSid ?? undefined) : undefined,
      templateName: channel === 'template' ? NEW_ORDER_TEMPLATE_NAME : undefined,
      metadata: successMetadata,
    });

    const messageRecord = await createOutboundMessage({
      conversationId: conversation.id,
      restaurantId,
      waSid: twilioResponse.sid,
      fromPhone: normalizedSender,
      toPhone: normalizedRecipient,
      messageType: 'text',
      content: trimmedText,
      metadata: {
        channel,
        recipientSource: options.toNumber ? 'override' : 'restaurant',
        senderSource: options.fromNumber ? 'override' : 'config',
        outboundLogId: outboundLog?.id ?? null,
      },
    });

    await updateConversation(conversation.id, {
      lastMessageAt: new Date(),
    });

    console.log(
      `✅ [WhatsAppNotify] Sent new order notification via ${channel} channel (SID: ${twilioResponse.sid}).`
    );

    return { sid: messageRecord.waSid || twilioResponse.sid, channel };
  } catch (error) {
    if (outboundLog && !failureLogged) {
      metadataState.lastErrorAt = new Date().toISOString();
      await markOutboundMessageFailed(outboundLog.id, {
        channel,
        error,
        metadata: metadataState,
      });
    }
    throw error;
  }
}

/**
 * Generic function to send a WhatsApp message with automatic 24h window detection
 * and template fallback for use by API endpoints
 */
export async function sendWhatsAppMessage(
  restaurantId: string,
  toPhoneNumber: string,
  messageText: string,
  options: {
    fromNumber?: string;
    templateSid?: string;
    templateName?: string;
  } = {}
): Promise<NotifyResult> {
  if (!restaurantId) {
    throw new Error('restaurantId is required.');
  }
  const trimmedText = messageText?.trim();
  if (!trimmedText) {
    throw new Error('messageText must be a non-empty string.');
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
  });

  if (!restaurant) {
    throw new Error(`Restaurant ${restaurantId} not found.`);
  }

  const fromNumber = options.fromNumber ?? TWILIO_WHATSAPP_FROM;
  if (!fromNumber) {
    throw new Error('No WhatsApp sender number configured.');
  }

  const standardizedRecipient = standardizeWhatsappNumber(toPhoneNumber);
  if (!standardizedRecipient) {
    throw new Error(`Invalid phone number: ${toPhoneNumber}`);
  }

  const normalizedRecipient = normalizePhoneNumber(standardizedRecipient);
  const normalizedSender = normalizePhoneNumber(fromNumber);

  const conversation = await findOrCreateConversation(
    restaurantId,
    normalizedRecipient,
    undefined
  );

  const client = getTwilioClient();
  const fromAddress = ensureWhatsAppAddress(fromNumber);
  const toAddress = ensureWhatsAppAddress(standardizedRecipient);

  const channelDecision = await determineChannel(restaurantId, conversation.id);
  let channel = channelDecision.channel;
  let twilioResponse;
  let usedTemplateSid: string | undefined;
  let usedTemplateName: string | undefined;
  // Controls whether to proceed with sending a template after recent-template logic
  let shouldSendTemplate = true;
  

  const metadataState: Record<string, any> = {
    request: {
      restaurantId,
      conversationId: conversation.id,
      toPhone: standardizedRecipient,
      fromPhone: fromNumber,
      initialChannel: channel,
      source: 'api',
    },
    sessionWindow: {
      lastInboundAt: channelDecision.lastInboundAt?.toISOString() ?? null,
      within24h: channelDecision.lastInboundAt
        ? Date.now() - channelDecision.lastInboundAt.getTime() <= SESSION_WINDOW_MS
        : false,
    },
  };

  const outboundLog = await createOutboundMessageLog({
    restaurantId,
    conversationId: conversation.id,
    toPhone: standardizedRecipient,
    fromPhone: fromNumber,
    body: trimmedText,
    channel,
    templateSid: options.templateSid ?? null,
    templateName: options.templateName ?? null,
    status: 'pending',
    metadata: metadataState,
  });

  let failureLogged = false;

  console.log(
    `🚀 [WhatsAppSend] Sending message to ${standardizedRecipient} using channel ${channel}.`,
    { restaurantId, conversationId: conversation.id }
  );

  try {
    try {
      if (channel === 'freeform') {
        twilioResponse = await sendFreeformMessage(client, fromAddress, toAddress, trimmedText);
      } else {
        // Use provided template or default to new_order_notification
        if (options.templateSid) {
          console.log('🧾 [WhatsAppSend] Using provided template SID.', {
            templateSid: options.templateSid,
            templateName: options.templateName,
          });
          twilioResponse = await client.messages.create({
            from: fromAddress,
            to: toAddress,
            contentSid: options.templateSid,
            contentVariables: JSON.stringify({ order_text: trimmedText }),
          });
          usedTemplateSid = options.templateSid;
          usedTemplateName = options.templateName;
        } else {
          twilioResponse = await sendTemplateMessage(client, fromAddress, toAddress, trimmedText);
          usedTemplateSid = cachedTemplateSid ?? undefined;
          usedTemplateName = NEW_ORDER_TEMPLATE_NAME;
        }
      }
    } catch (error) {
      if (channel === 'freeform' && isSessionExpiredError(error)) {
        console.warn(
          '⚠️ [WhatsAppSend] Freeform send rejected with session timeout (63016). Retrying with template.'
        );
        channel = 'template';
        metadataState.fallback = {
          reason: 'session_window_expired',
          retriedAt: new Date().toISOString(),
        };

        // Use provided template or default
        if (options.templateSid) {
          usedTemplateSid = options.templateSid;
          usedTemplateName = options.templateName;
        } else {
          usedTemplateSid = await ensureNewOrderTemplateSid();
          usedTemplateName = NEW_ORDER_TEMPLATE_NAME;
        }

        await updateOutboundMessageChannel(
          outboundLog?.id ?? null,
          channel,
          metadataState,
          usedTemplateSid,
          usedTemplateName
        );

        if (options.templateSid) {
          twilioResponse = await client.messages.create({
            from: fromAddress,
            to: toAddress,
            contentSid: options.templateSid,
            contentVariables: JSON.stringify({ order_text: trimmedText }),
          });
        } else {
          twilioResponse = await sendTemplateMessage(client, fromAddress, toAddress, trimmedText);
        }
      } else {
        console.error('❌ [WhatsAppSend] Twilio send failed.', {
          channel,
          restaurantId,
          recipient: standardizedRecipient,
          error,
        });
        metadataState.lastErrorAt = new Date().toISOString();
        await markOutboundMessageFailed(outboundLog?.id ?? null, {
          channel,
          error,
          metadata: metadataState,
        });
        failureLogged = true;
        throw error;
      }
    }

    const successMetadata = {
      ...metadataState,
      result: {
        channel,
        sid: twilioResponse?.sid,
        sentAt: new Date().toISOString(),
        templateSid: usedTemplateSid,
        templateName: usedTemplateName,
      },
    };

    await markOutboundMessageSent(outboundLog?.id ?? null, {
      channel,
      waSid: twilioResponse?.sid || 'unknown',
      templateSid: usedTemplateSid,
      templateName: usedTemplateName,
      metadata: successMetadata,
    });

    const messageRecord = await createOutboundMessage({
      conversationId: conversation.id,
      restaurantId,
      waSid: twilioResponse.sid,
      fromPhone: normalizedSender,
      toPhone: normalizedRecipient,
      messageType: 'text',
      content: trimmedText,
      metadata: {
        channel,
        source: 'api',
        templateSid: usedTemplateSid,
        templateName: usedTemplateName,
        outboundLogId: outboundLog?.id ?? null,
      },
    });

    await updateConversation(conversation.id, {
      lastMessageAt: new Date(),
    });

    console.log(
      `✅ [WhatsAppSend] Sent message via ${channel} channel (SID: ${twilioResponse.sid}).`
    );

    return { sid: messageRecord.waSid || twilioResponse.sid, channel };
  } catch (error) {
    if (outboundLog && !failureLogged) {
      metadataState.lastErrorAt = new Date().toISOString();
      await markOutboundMessageFailed(outboundLog.id, {
        channel,
        error,
        metadata: metadataState,
      });
    }
    throw error;
  }
}

/**
 * Check if a phone number has messaged us within the 24h window
 */
async function checkMessageWindow(phoneNumber: string): Promise<{
  withinWindow: boolean;
  lastInboundAt: Date | null;
}> {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  
  console.log(`📊 [MessageWindow] Checking window for ${phoneNumber} (normalized: ${normalizedPhone})`);
  
  // Check for any inbound message FROM this phone number (customer → us)
  const lastInbound = await prisma.message.findFirst({
    where: {
      direction: 'IN',
      conversation: {
        customerWa: normalizedPhone,
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      createdAt: true,
    },
  });

  if (!lastInbound) {
    console.log(`📊 [MessageWindow] No inbound history found for ${phoneNumber}`);
    return { withinWindow: false, lastInboundAt: null };
  }

  const elapsed = Date.now() - lastInbound.createdAt.getTime();
  const withinWindow = elapsed <= SESSION_WINDOW_MS;
  
  console.log(
    `📊 [MessageWindow] Last inbound from ${phoneNumber}: ${lastInbound.createdAt.toISOString()} (${Math.round(
      elapsed / 60000
    )} minutes ago) - ${withinWindow ? 'WITHIN' : 'OUTSIDE'} 24h window`
  );

  return {
    withinWindow,
    lastInboundAt: lastInbound.createdAt,
  };
}

/**
 * Retrieve cached message from the most recent template message sent to a phone number
 */
export async function getCachedMessageForPhone(phoneNumber: string): Promise<string | null> {
  const standardizedPhone = standardizeWhatsappNumber(phoneNumber);
  
  console.log(`📦 [Cache] Looking up cached message for ${phoneNumber} (standardized: ${standardizedPhone})`);
  
  const model = (prisma as any)?.outboundMessage;
  if (!model) {
    console.warn('⚠️ OutboundMessage model not available');
    return null;
  }
  
  // Find the most recent template message sent to this phone number
  const recentTemplate = await model.findFirst({
    where: {
      toPhone: standardizedPhone,
      channel: 'template',
      templateName: ORDER_NOTIFICATION_WITH_BUTTON,
      status: 'sent',
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      metadata: true,
      body: true,
    },
  });
  
  if (!recentTemplate) {
    console.log(`ℹ️ [Cache] No template record found for ${phoneNumber}`);
    return null;
  }
  
  console.log(`📦 [Cache] Found template record for ${phoneNumber}`, {
    hasMetadata: !!recentTemplate.metadata,
    hasBody: !!recentTemplate.body,
  });
  
  // Try to get cached message from metadata first
  if (recentTemplate.metadata && typeof recentTemplate.metadata === 'object') {
    const metadata = recentTemplate.metadata as any;
    if (metadata.cachedMessage?.text) {
      const preview = metadata.cachedMessage.text.substring(0, 80);
      console.log(`✅ [Cache] Retrieved cached message from metadata for ${phoneNumber}: "${preview}..."`);
      return metadata.cachedMessage.text;
    }
  }
  
  // Fallback to body field
  if (recentTemplate.body) {
    const preview = recentTemplate.body.substring(0, 80);
    console.log(`✅ [Cache] Retrieved cached message from body field for ${phoneNumber}: "${preview}..."`);
    return recentTemplate.body;
  }
  
  console.log(`⚠️ [Cache] Found template record but no cached message for ${phoneNumber}`);
  return null;
}

/**
 * Find the most recent sent order-button template to this phone since a timestamp (last inbound),
 * used to decide whether to resend a template or just update the cached payload.
 */
async function findRecentTemplateSince(
  toPhoneNumber: string,
  since: Date | null
): Promise<{ id: string; waSid: string | null; createdAt: Date; metadata: any } | null> {
  const standardizedPhone = standardizeWhatsappNumber(toPhoneNumber);
  
  console.log(`🔍 [FindTemplate] Looking for template sent to ${toPhoneNumber} (standardized: ${standardizedPhone})`, {
    since: since?.toISOString() || 'any time',
    templateName: ORDER_NOTIFICATION_WITH_BUTTON,
  });
  
  const model = (prisma as any)?.outboundMessage;
  if (!model) {
    console.warn('⚠️ [FindTemplate] OutboundMessage model not available');
    return null;
  }

  const where: any = {
    toPhone: standardizedPhone,
    channel: 'template',
    templateName: ORDER_NOTIFICATION_WITH_BUTTON,
    status: 'sent',
  };
  if (since) {
    where.createdAt = { gt: since };
  }

  const record = await model.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    select: { id: true, waSid: true, createdAt: true, metadata: true },
  });
  
  if (record) {
    console.log(`✅ [FindTemplate] Found template ${record.id} sent at ${record.createdAt.toISOString()}`);
  } else {
    console.log(`ℹ️ [FindTemplate] No matching template found for ${standardizedPhone}`);
  }
  
  return (record as any) ?? null;
}

/**
 * Set cachedMessage.text on a previously-sent template record.
 * If onlyIfMissing is true, do not overwrite existing cachedMessage.
 * Returns true if a write occurred.
 */
async function setCachedMessageOnTemplate(
  outboundId: string,
  phoneNumber: string,
  text: string,
  onlyIfMissing = true
): Promise<boolean> {
  const model = (prisma as any)?.outboundMessage;
  if (!model) return false;

  const existing = await model.findUnique({
    where: { id: outboundId },
    select: { metadata: true },
  });
  const metadata = (existing?.metadata && typeof existing.metadata === 'object')
    ? { ...(existing.metadata as any) }
    : {};

  const hasExisting = Boolean(metadata?.cachedMessage?.text);
  if (onlyIfMissing && hasExisting) {
    console.log(`📦 [Cache] Skipping cache update for ${phoneNumber} - already has cached message (onlyIfMissing=true)`);
    return false;
  }

  metadata.cachedMessage = {
    text,
    cachedAt: new Date().toISOString(),
    purpose: 'view_order_details_response',
  };

  await model.update({
    where: { id: outboundId },
    data: {
      metadata: { set: metadata },
      // also store the body to allow simpler fallbacks
      body: text,
    },
  });
  console.log(`📦 [Cache] Updated cachedMessage on template ${outboundId} for ${phoneNumber} (${text.substring(0, 50)}...)`);
  return true;
}

/**
 * Retrieve and mark the cached message as consumed for a phone number.
 * Returns the cached text or null if not available.
 */
export async function consumeCachedMessageForPhone(phoneNumber: string): Promise<string | null> {
  const standardizedPhone = standardizeWhatsappNumber(phoneNumber);
  
  console.log(`📦 [ConsumeCache] Retrieving and consuming cache for ${phoneNumber} (standardized: ${standardizedPhone})`);
  
  // Prefer new MessageCache table when available; otherwise fall back to legacy metadata
  const messageCacheModel = (prisma as any)?.messageCache;
  if (messageCacheModel) {
    // Find the most recent undelivered cache entry for this phone
    const cacheEntry = await messageCacheModel.findFirst({
      where: {
        toPhone: standardizedPhone,
        delivered: false,
        expiresAt: {
          gt: new Date(), // Not expired
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    
    if (!cacheEntry) {
      console.log(`ℹ️ [ConsumeCache] No valid cache entry found for ${standardizedPhone}`);
    } else {
      const preview = cacheEntry.messageText.substring(0, 80);
      console.log(`✅ [ConsumeCache] Found cache entry ${cacheEntry.id}: "${preview}..."`);
      
      // Mark as delivered
      await messageCacheModel.update({
        where: { id: cacheEntry.id },
        data: {
          delivered: true,
          deliveredAt: new Date(),
        },
      });
      
      console.log(`✅ [ConsumeCache] Marked cache entry ${cacheEntry.id} as delivered for ${standardizedPhone}`);
      
      return cacheEntry.messageText;
    }
  } else {
    console.warn('⚠️ [ConsumeCache] MessageCache model not available on Prisma client; using legacy metadata fallback');
  }
  
  // Fallback to old method (metadata) for backwards compatibility
  const model = (prisma as any)?.outboundMessage;
  if (!model) {
    console.warn('⚠️ [ConsumeCache] OutboundMessage model not available for fallback');
    return null;
  }
  
  const recent = await findRecentTemplateSince(standardizedPhone, null);
  if (!recent) {
    console.log(`ℹ️ [ConsumeCache] No recent template found for ${standardizedPhone}`);
    return null;
  }
  
  const metadata = (recent.metadata && typeof recent.metadata === 'object')
    ? { ...(recent.metadata as any) }
    : {};
  
  const cachedText: string | undefined = metadata?.cachedMessage?.text;
  
  if (!cachedText) {
    console.log(`⚠️ [ConsumeCache] No cached message in metadata for ${standardizedPhone}`);
    return null;
  }
  
  console.log(`✅ [ConsumeCache] Found cached message in metadata (fallback): "${cachedText.substring(0, 80)}..."`);
  return cachedText;
}

/**
 * Simplified notification function for standalone API use
 * Checks database first to determine if within 24h window
 */
export async function sendNotification(
  toPhoneNumber: string,
  messageText: string,
  options: {
    fromNumber?: string;
    templateVariables?: Record<string, any>;
    forceFreeform?: boolean; // If true, skip 24h check and send freeform directly (e.g., after button click)
  } = {}
): Promise<NotifyResult> {
  const trimmedText = messageText?.trim();
  if (!trimmedText) {
    throw new Error('messageText must be a non-empty string.');
  }

  const fromNumber = options.fromNumber ?? TWILIO_WHATSAPP_FROM;
  if (!fromNumber) {
    throw new Error('No WhatsApp sender number configured.');
  }

  const standardizedRecipient = standardizeWhatsappNumber(toPhoneNumber);
  if (!standardizedRecipient) {
    throw new Error(`Invalid phone number: ${toPhoneNumber}`);
  }

  const client = getTwilioClient();
  const fromAddress = ensureWhatsAppAddress(fromNumber);
  const toAddress = ensureWhatsAppAddress(standardizedRecipient);

  // Check database FIRST to determine channel (unless forceFreeform is set)
  let windowCheck: { withinWindow: boolean; lastInboundAt: Date | null };
  let channel: SendChannel;
  
  if (options.forceFreeform) {
    console.log(`📤 [Notification] Force freeform mode enabled - sending as freeform message directly`);
    channel = 'freeform';
    windowCheck = { withinWindow: true, lastInboundAt: new Date() };
  } else {
    windowCheck = await checkMessageWindow(standardizedRecipient);
    channel = windowCheck.withinWindow ? 'freeform' : 'template';
  }
  let twilioResponse;
  let usedTemplateSid: string | undefined;
  let usedTemplateName: string | undefined;
  // Controls whether to proceed with sending a template after recent-template logic
  let shouldSendTemplate = true;

  const metadataState: Record<string, any> = {
    request: {
      toPhone: standardizedRecipient,
      fromPhone: fromNumber,
      initialChannel: channel,
      source: 'notification_api',
      attemptedAt: new Date().toISOString(),
    },
    sessionWindow: {
      lastInboundAt: windowCheck.lastInboundAt?.toISOString() ?? null,
      within24h: windowCheck.withinWindow,
      checkedAt: new Date().toISOString(),
    },
  };

  const outboundLog = await createOutboundMessageLog({
    restaurantId: null,
    conversationId: null,
    toPhone: standardizedRecipient,
    fromPhone: fromNumber,
    body: trimmedText,
    channel,
    status: 'pending',
    metadata: metadataState,
  });

  let failureLogged = false;

  console.log(
    `📤 [Notification] Sending to ${standardizedRecipient} via ${channel} channel (based on DB check).`
  );

  try {
    if (channel === 'freeform') {
      // Within 24h window - send freeform
      twilioResponse = await sendFreeformMessage(client, fromAddress, toAddress, trimmedText);
      console.log(`✅ [Notification] Sent as freeform message (within 24h window).`);
    } else {
      // Outside 24h window or no history
      // Check if we sent a template in the last 24h to prevent spam
      const recentTemplate = await findRecentTemplateSince(standardizedRecipient, windowCheck.lastInboundAt);
      
      if (recentTemplate) {
        // Check if the template was sent within the last 24h
        const templateAge = Date.now() - recentTemplate.createdAt.getTime();
        const templateWithin24h = templateAge <= SESSION_WINDOW_MS;
        
        if (templateWithin24h) {
          console.log(`♻️ [Notification] Template sent ${Math.round(templateAge / 60000)} minutes ago (within 24h); attempting to send freeform text now.`);
          try {
            // Try sending freeform despite being in template path due to recent template
            channel = 'freeform';
            metadataState.fallback = {
              reason: 'recent_template_within_24h_send_freeform',
              retriedAt: new Date().toISOString(),
            };
            await updateOutboundMessageChannel(
              outboundLog?.id ?? null,
              channel,
              metadataState
            );
            twilioResponse = await sendFreeformMessage(client, fromAddress, toAddress, trimmedText);
            console.log(`✅ [Notification] Sent as freeform message (recent template within 24h).`);
            // Avoid sending another template below
            shouldSendTemplate = false;
          } catch (error) {
            if (isSessionExpiredError(error)) {
              // If WhatsApp still rejects freeform (e.g., no 24h window), fall back to cache-only behavior
              console.warn('⚠️ [Notification] Freeform send rejected (63016). Updating cache and skipping new template.');
              // Revert channel label for record-keeping
              channel = 'template';
              await setCachedMessageOnTemplate(recentTemplate.id, standardizedRecipient, trimmedText, false); // false = always update
              
              // Also update MessageCache
              const existingCache = await (prisma as any)?.messageCache?.findFirst({
                where: {
                  toPhone: standardizedRecipient,
                  delivered: false,
                },
                orderBy: { createdAt: 'desc' },
              });
              
              if (existingCache) {
                await (prisma as any).messageCache.update({
                  where: { id: existingCache.id },
                  data: {
                    messageText: trimmedText,
                    updatedAt: new Date(),
                  },
                });
                console.log(`📦 [MessageCache] Updated existing cache entry ${existingCache.id} with new message`);
              } else {
                // Create new cache entry
                const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
                await (prisma as any).messageCache.create({
                  data: {
                    toPhone: standardizedRecipient,
                    fromPhone: fromNumber,
                    messageText: trimmedText,
                    templateName: ORDER_NOTIFICATION_WITH_BUTTON,
                    outboundMessageId: recentTemplate.id,
                    expiresAt,
                    metadata: {
                      source: 'notification_api',
                      reason: 'template_update',
                    },
                  },
                });
                console.log(`📦 [MessageCache] Created new cache entry for ${standardizedRecipient}`);
              }
              // Return synthetic result (no new Twilio send)
              return { sid: recentTemplate.waSid || recentTemplate.id, channel: 'template' };
            }
            // Non-63016 errors propagate to outer error handling
            throw error;
          }
        } else {
          console.log(`🔄 [Notification] Last template was sent ${Math.round(templateAge / 60000)} minutes ago (>24h); sending fresh template.`);
        }
      }
      
      if (shouldSendTemplate) {
        // Use template with button (first message of new window)
        console.log('🧾 [Notification] Using template with button (first message of window).');
        
        usedTemplateSid = await ensureOrderButtonTemplateSid();
        usedTemplateName = ORDER_NOTIFICATION_WITH_BUTTON;
  
        // Cache the original message text for later retrieval when user clicks button
        metadataState.template = {
          sid: usedTemplateSid,
          name: usedTemplateName,
          reason: windowCheck.lastInboundAt ? 'window_expired' : 'no_conversation_history',
        };
        
        metadataState.cachedMessage = {
          text: trimmedText,
          cachedAt: new Date().toISOString(),
          purpose: 'view_order_details_response',
          firstInWindow: true,
        };
  
        await updateOutboundMessageChannel(
          outboundLog?.id ?? null,
          channel,
          metadataState,
          usedTemplateSid,
          usedTemplateName
        );
  
        const sendParams: any = {
          from: fromAddress,
          to: toAddress,
          contentSid: usedTemplateSid,
        };
  
        // Map variables to numbered format expected by Twilio
        // If templateVariables provided, use them; otherwise use trimmedText as default
        if (options.templateVariables && Object.keys(options.templateVariables).length > 0) {
          // User provided variables - convert to numbered format if needed
          const numberedVars: Record<string, any> = {};
          Object.entries(options.templateVariables).forEach(([key, value], index) => {
            // If key is already a number, use it; otherwise map by index
            const varKey = /^\d+$/.test(key) ? key : String(index + 1);
            numberedVars[varKey] = value;
          });
          sendParams.contentVariables = JSON.stringify(numberedVars);
        } else {
          // Default: assume single variable template with message text
          sendParams.contentVariables = JSON.stringify({
            "1": trimmedText
          });
        }
  
        console.log('🧾 [Notification] Template send params prepared.', {
          contentSid: sendParams.contentSid,
        });
  
        twilioResponse = await client.messages.create(sendParams);
  
        console.log(`✅ [Notification] Sent as template message with "View Order Details" button.`);
        
        // Save message to MessageCache for button click retrieval
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
        const cacheEntry = await (prisma as any).messageCache?.create({
          data: {
            toPhone: standardizedRecipient,
            fromPhone: fromNumber,
            messageText: trimmedText,
            templateName: usedTemplateName,
            templateSid: usedTemplateSid,
            outboundMessageId: outboundLog?.id ?? undefined,
            expiresAt,
            metadata: {
              source: 'notification_api',
              reason: windowCheck.lastInboundAt ? 'window_expired' : 'no_conversation_history',
              waSid: twilioResponse.sid,
            },
          },
        });
        if (cacheEntry) {
          console.log(`📦 [MessageCache] Created cache entry ${cacheEntry.id} for template ${usedTemplateName}`);
        } else {
          console.warn('⚠️ [MessageCache] Prisma client has no messageCache model; skipped cache creation');
        }
      }
    }
  
    // Ensure we have a Twilio response before proceeding
    if (!twilioResponse || !twilioResponse.sid) {
      throw new Error('Twilio response missing after send operation');
    }

    const successMetadata = {
      ...metadataState,
      result: {
        channel,
        sid: twilioResponse.sid,
        sentAt: new Date().toISOString(),
        templateSid: usedTemplateSid,
        templateName: usedTemplateName,
      },
    };
  
    await markOutboundMessageSent(outboundLog?.id ?? null, {
      channel,
      waSid: twilioResponse.sid,
      templateSid: usedTemplateSid,
      templateName: usedTemplateName,
      metadata: successMetadata,
    });
  
    console.log(
      `✅ [Notification] Message delivered via ${channel} channel (SID: ${twilioResponse.sid}).`
    );
  
    return { sid: twilioResponse.sid, channel };
  } catch (error) {
    console.error('❌ [Notification] Failed to send message.', {
      recipient: standardizedRecipient,
      channel,
      error,
    });
    metadataState.lastErrorAt = new Date().toISOString();
    await markOutboundMessageFailed(outboundLog?.id ?? null, {
      channel,
      error,
      metadata: metadataState,
    });
    throw error;
  }
}
