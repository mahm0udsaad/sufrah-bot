import twilio from 'twilio';
import { prisma } from '../db/client';
import { findOrCreateConversation, updateConversation } from '../db/conversationService';
import { createOutboundMessage } from '../db/messageService';
import {
  ensureWhatsAppAddress,
  normalizePhoneNumber,
  standardizeWhatsappNumber,
} from '../utils/phone';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  TWILIO_TEMPLATE_NEW_ORDER,
  TWILIO_API_KEY,
  TWILIO_API_SECRET,
  TWILIO_CONTENT_AUTH,
} from '../config';

type TwilioClient = ReturnType<typeof twilio>;

type SendChannel = 'freeform' | 'template';

interface NotifyResult {
  sid: string;
  channel: SendChannel;
}

interface NotifyRestaurantOrderOptions {
  toNumber?: string;
  fromNumber?: string;
}

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
const NEW_ORDER_TEMPLATE_NAME = 'new_order_notification';
const CONTENT_BASE_URL = 'https://content.twilio.com/v1/Content';

let sharedTwilioClient: TwilioClient | null = null;
let cachedTemplateSid = TWILIO_TEMPLATE_NEW_ORDER || '';
let ensureTemplatePromise: Promise<string> | null = null;

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

async function fetchExistingTemplateSid(authHeader: string): Promise<string | null> {
  try {
    const url = new URL(CONTENT_BASE_URL);
    url.searchParams.set('FriendlyName', NEW_ORDER_TEMPLATE_NAME);
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
      return friendlyName === NEW_ORDER_TEMPLATE_NAME;
    });

    return typeof match?.sid === 'string' ? match.sid : null;
  } catch (error) {
    console.error('⚠️ Error fetching existing Twilio content:', error);
    return null;
  }
}

async function createNewOrderTemplate(authHeader: string): Promise<string> {
  const payload = {
    friendly_name: NEW_ORDER_TEMPLATE_NAME,
    language: 'en',
    types: {
      'twilio/text': {
        body: 'You have a new order on Sufrah! {{order_text}}',
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
      const existing = await fetchExistingTemplateSid(authHeader);
      if (existing) {
        return existing;
      }
    }
    throw new Error(`Twilio Content API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const sid = json?.sid;
  if (typeof sid !== 'string' || !sid) {
    throw new Error('Twilio Content API did not return a SID for the new template.');
  }

  console.log(`✅ Created Twilio content template ${NEW_ORDER_TEMPLATE_NAME}: ${sid}`);
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
    const existing = await fetchExistingTemplateSid(authHeader);
    if (existing) {
      cachedTemplateSid = existing;
      process.env.TWILIO_TEMPLATE_NEW_ORDER = existing;
      return existing;
    }

    const created = await createNewOrderTemplate(authHeader);
    cachedTemplateSid = created;
    process.env.TWILIO_TEMPLATE_NEW_ORDER = created;
    console.info(
      'ℹ️ Store the new Twilio template SID in TWILIO_TEMPLATE_NEW_ORDER to reuse across deploys.'
    );
    return created;
  })();

  try {
    return await ensureTemplatePromise;
  } finally {
    ensureTemplatePromise = null;
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
  return client.messages.create({
    from,
    to,
    contentSid,
    contentVariables: JSON.stringify({ order_text: body }),
  });
}

async function getLastInboundMessageTimestamp(restaurantId: string): Promise<Date | null> {
  const record = await prisma.message.findFirst({
    where: {
      restaurantId,
      direction: 'IN',
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return record?.createdAt ?? null;
}

async function determineChannel(restaurantId: string): Promise<SendChannel> {
  const lastInboundAt = await getLastInboundMessageTimestamp(restaurantId);
  if (!lastInboundAt) {
    return 'template';
  }
  const elapsed = Date.now() - lastInboundAt.getTime();
  return elapsed <= SESSION_WINDOW_MS ? 'freeform' : 'template';
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

  let channel = await determineChannel(restaurantId);
  let twilioResponse;

  try {
    if (channel === 'freeform') {
      twilioResponse = await sendFreeformMessage(client, fromAddress, toAddress, trimmedText);
    } else {
      twilioResponse = await sendTemplateMessage(client, fromAddress, toAddress, trimmedText);
    }
  } catch (error) {
    if (channel === 'freeform' && isSessionExpiredError(error)) {
      console.warn('⚠️ Session window closed, falling back to template message.');
      channel = 'template';
      twilioResponse = await sendTemplateMessage(client, fromAddress, toAddress, trimmedText);
    } else {
      throw error;
    }
  }

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
    },
  });

  await updateConversation(conversation.id, {
    lastMessageAt: new Date(),
  });

  return { sid: messageRecord.waSid || twilioResponse.sid, channel };
}
