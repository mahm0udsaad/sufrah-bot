import { jsonResponse } from '../../http';
import { normalizePhoneNumber } from '../../../utils/phone';
import {
  getConversations as getStoredConversations,
  getConversationMessages as getStoredConversationMessages,
  getConversationById as getStoredConversationById,
  getOrCreateConversation,
  markConversationRead as markStoredConversationRead,
  setConversationData,
} from '../../../state/conversations';
import { mapConversationToApi, mapMessageToApi } from '../../../workflows/mappers';
import { sendMediaMessage, sendTextMessage } from '../../../twilio/messaging';
import { TwilioClientManager } from '../../../twilio/clientManager';
import { TWILIO_WHATSAPP_FROM, DASHBOARD_PAT, BOT_API_TOKEN, BOT_API_KEY } from '../../../config';
import { resolveRestaurantContext } from '../../../handlers/processMessage';
import {
  updateConversation as updateDbConversation,
  findOrCreateConversation,
  listConversations as listDbConversations,
  markConversationRead as markDbConversationRead,
  getConversationByRestaurantAndCustomer,
} from '../../../db/conversationService';
import {
  createOutboundMessage,
  updateMessageWithSid,
  listMessages as listDbMessages,
} from '../../../db/messageService';
import type { MessageType, StoredConversation, StoredMessage } from '../../../types';
import type { Conversation as DbConversation, Message as DbMessage } from '@prisma/client';
import { getRestaurantById } from '../../../db/restaurantService';

const twilioClientManager = new TwilioClientManager();

type AuthType = 'pat' | 'bot_token' | 'api_key';

function authenticate(req: Request): { ok: boolean; type?: AuthType; restaurantId?: string; error?: string } {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';

  let token = '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
  const apiToken = authHeader.match(/^ApiToken\s+(.+)$/i);
  if (bearer && bearer[1]) token = bearer[1].trim();
  else if (apiToken && apiToken[1]) token = apiToken[1].trim();

  if (DASHBOARD_PAT && token && token === DASHBOARD_PAT) {
    const restaurantId = (req.headers.get('x-restaurant-id') || '').trim();
    if (!restaurantId) {
      return { ok: false, type: 'pat', error: 'X-Restaurant-Id header is required for PAT' };
    }
    return { ok: true, type: 'pat', restaurantId };
  }

  if (BOT_API_TOKEN && token && token === BOT_API_TOKEN) {
    return { ok: true, type: 'bot_token' };
  }

  if (BOT_API_KEY && apiKeyHeader && apiKeyHeader === BOT_API_KEY) {
    return { ok: true, type: 'api_key' };
  }

  return { ok: false, error: 'Unauthorized' };
}

function mapDbConversationToStored(conversation: DbConversation): StoredConversation {
  const normalizedPhone = normalizePhoneNumber(conversation.customerWa);
  return {
    id: normalizedPhone,
    customerPhone: normalizedPhone,
    customerName: conversation.customerName ?? undefined,
    status: conversation.status,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    unreadCount: conversation.unreadCount,
    isBotActive: conversation.isBotActive,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

function mapDbMessageToStored(message: DbMessage, conversationPhone: string): StoredMessage {
  const metadata = (message.metadata ?? {}) as { fromPhone?: unknown; toPhone?: unknown };
  const fromPhoneRaw = typeof metadata.fromPhone === 'string' ? metadata.fromPhone : undefined;
  const toPhoneRaw = typeof metadata.toPhone === 'string' ? metadata.toPhone : undefined;

  const normalizedConversationPhone = normalizePhoneNumber(conversationPhone);
  const fromPhone = fromPhoneRaw ? normalizePhoneNumber(fromPhoneRaw) : normalizedConversationPhone;
  const toPhone = toPhoneRaw ? normalizePhoneNumber(toPhoneRaw) : normalizedConversationPhone;

  return {
    id: message.id,
    conversationId: normalizedConversationPhone,
    fromPhone,
    toPhone,
    messageType: message.messageType as MessageType,
    content: message.content,
    mediaUrl: message.mediaUrl ?? null,
    timestamp: message.createdAt.toISOString(),
    isFromCustomer: message.direction === 'IN',
  };
}

export async function handleConversationsApi(req: Request, url: URL): Promise<Response | null> {
  if (req.method === 'GET' && url.pathname === '/api/conversations') {
    const auth = authenticate(req);
    if (!auth.ok) {
      const status = auth.error?.includes('required') ? 400 : 401;
      return jsonResponse({ error: auth.error || 'Unauthorized' }, status);
    }
    if (auth.type === 'pat') {
      const statusParam = url.searchParams.get('status');
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const statusFilter =
        statusParam === 'active' || statusParam === 'closed'
          ? (statusParam as DbConversation['status'])
          : undefined;

      const conversations = await listDbConversations(auth.restaurantId!, {
        status: statusFilter,
        limit,
        offset,
      });

      const response = conversations
        .map(mapDbConversationToStored)
        .map(mapConversationToApi);

      return jsonResponse(response);
    }

    const data = getStoredConversations().map(mapConversationToApi);
    return jsonResponse(data);
  }

  if (req.method === 'GET' && /^\/api\/conversations\//.test(url.pathname)) {
    const messagesMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (messagesMatch) {
      const auth = authenticate(req);
      if (!auth.ok) {
        const status = auth.error?.includes('required') ? 400 : 401;
        return jsonResponse({ error: auth.error || 'Unauthorized' }, status);
      }
      if (auth.type === 'pat') {
        // Ensure restaurant exists for provided header (ownership checks simplified)
        const restaurant = auth.restaurantId ? await getRestaurantById(auth.restaurantId) : null;
        if (!restaurant) {
          return jsonResponse({ error: 'Restaurant not found' }, 404);
        }
      }
      const conversationIdRaw = messagesMatch[1];
      if (!conversationIdRaw) {
        return jsonResponse({ error: 'Conversation id required' }, 400);
      }
      const normalizedId = normalizePhoneNumber(decodeURIComponent(conversationIdRaw));
      if (auth.type === 'pat') {
        const limit = parseInt(url.searchParams.get('limit') || '100', 10);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);

        const dbConversation = await getConversationByRestaurantAndCustomer(
          auth.restaurantId!,
          normalizedId
        );
        if (!dbConversation) {
          return jsonResponse({ error: 'Conversation not found' }, 404);
        }

        const dbMessages = await listDbMessages(dbConversation.id, { limit, offset });
        const storedMessages = dbMessages.map((msg) =>
          mapDbMessageToStored(msg, normalizedId)
        );

        await markDbConversationRead(dbConversation.id).catch((err) => {
          console.error('⚠️ Failed to mark DB conversation as read:', err);
        });

        markStoredConversationRead(normalizedId);
        return jsonResponse(storedMessages.map(mapMessageToApi));
      }

      const messages = getStoredConversationMessages(normalizedId);
      if (!messages.length && !getStoredConversationById(normalizedId)) {
        return jsonResponse({ error: 'Conversation not found' }, 404);
      }
      markStoredConversationRead(normalizedId);
      return jsonResponse(messages.map(mapMessageToApi));
    }
  }

  if (req.method === 'POST' && /^\/api\/conversations\//.test(url.pathname)) {
    const sendMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/send$/);
    if (sendMatch) {
      const auth = authenticate(req);
      if (!auth.ok) {
        const status = auth.error?.includes('required') ? 400 : 401;
        return jsonResponse({ error: auth.error || 'Unauthorized' }, status);
      }
      const conversationIdRaw = sendMatch[1];
      if (!conversationIdRaw) {
        return jsonResponse({ error: 'Conversation id required' }, 400);
      }
      const normalizedId = normalizePhoneNumber(decodeURIComponent(conversationIdRaw));
      const body = (await req.json().catch(() => ({}))) as { message?: string };
      const messageText = typeof body.message === 'string' ? body.message.trim() : '';
      if (!messageText) {
        return jsonResponse({ error: 'Message is required' }, 400);
      }

      try {
        const restaurant = auth.type === 'pat'
          ? await getRestaurantById(auth.restaurantId!)
          : await resolveRestaurantContext(normalizedId);
        if (!restaurant) {
          return jsonResponse({ error: 'Restaurant context not found for conversation' }, 404);
        }
        const twilioClient = await twilioClientManager.getClient(restaurant.id);
        if (!twilioClient) {
          return jsonResponse({ error: 'Twilio client not configured for this restaurant' }, 500);
        }
        const fromNumber = restaurant.whatsappNumber || TWILIO_WHATSAPP_FROM;
        if (!fromNumber) {
          return jsonResponse({ error: 'Restaurant WhatsApp number not configured' }, 500);
        }

        const conversationRecord = await findOrCreateConversation(restaurant.id, normalizedId);
        const twilioMessage = await sendTextMessage(
          twilioClient,
          fromNumber,
          normalizedId,
          messageText
        );

        try {
          // Save to both OutboundMessage (for tracking) and Message (for chat history)
          const outboundRecord = await createOutboundMessage({
            conversationId: conversationRecord.id,
            restaurantId: restaurant.id,
            fromPhone: fromNumber,
            toPhone: normalizedId,
            messageType: 'text',
            content: messageText,
          });
          
          if (twilioMessage?.sid) {
            await updateMessageWithSid(outboundRecord.id, twilioMessage.sid);
          }
          
          await updateDbConversation(conversationRecord.id, {
            lastMessageAt: new Date(),
            unreadCount: 0,
          });
        } catch (logError) {
          console.error('⚠️ Failed to persist outbound message log:', logError);
        }

        markStoredConversationRead(normalizedId);
        setConversationData(normalizedId, { status: 'active', isBotActive: true });
        const messages = getStoredConversationMessages(normalizedId);
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage) {
          return jsonResponse({ message: null }, 202);
        }
        return jsonResponse({ message: mapMessageToApi(lastMessage) });
      } catch (error) {
        console.error('❌ Failed to send manual message:', error);
        return jsonResponse({ error: 'Failed to send message' }, 500);
      }
    }

    const sendMediaMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/send-media$/);
    if (sendMediaMatch) {
      const auth = authenticate(req);
      if (!auth.ok) {
        const status = auth.error?.includes('required') ? 400 : 401;
        return jsonResponse({ error: auth.error || 'Unauthorized' }, status);
      }
      const conversationIdRaw = sendMediaMatch[1];
      if (!conversationIdRaw) {
        return jsonResponse({ error: 'Conversation id required' }, 400);
      }

      const normalizedId = normalizePhoneNumber(decodeURIComponent(conversationIdRaw));
      const contentType = req.headers.get('content-type') ?? '';
      const mediaUrls: string[] = [];
      let caption: string | undefined;
      let requestedType: string | undefined;

      if (contentType.includes('application/json')) {
        const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        if (typeof payload.mediaUrl === 'string' && payload.mediaUrl.trim()) {
          mediaUrls.push(payload.mediaUrl.trim());
        }
        if (Array.isArray(payload.mediaUrls)) {
          for (const candidate of payload.mediaUrls) {
            if (typeof candidate === 'string' && candidate.trim()) {
              mediaUrls.push(candidate.trim());
            }
          }
        }
        caption = typeof payload.caption === 'string' ? payload.caption.trim() : undefined;
        requestedType = typeof payload.mediaType === 'string' ? payload.mediaType.toLowerCase() : undefined;
      } else if (contentType.includes('multipart/form-data')) {
        const form = await req.formData();
        const singleUrl = form.get('mediaUrl');
        if (typeof singleUrl === 'string' && singleUrl.trim()) {
          mediaUrls.push(singleUrl.trim());
        }
        for (const candidate of form.getAll('mediaUrls')) {
          if (typeof candidate === 'string' && candidate.trim()) {
            mediaUrls.push(candidate.trim());
          }
        }
        const uploadedFile = form.get('file');
        if (uploadedFile && typeof uploadedFile === 'object') {
          return jsonResponse({ error: 'Direct file uploads are not supported; provide a temporary mediaUrl instead' }, 422);
        }
        const captionValue = form.get('caption');
        caption = typeof captionValue === 'string' ? captionValue.trim() : undefined;
        const typeValue = form.get('mediaType');
        requestedType = typeof typeValue === 'string' ? typeValue.toLowerCase() : undefined;
      } else {
        return jsonResponse({ error: 'Unsupported content type; use JSON or multipart form data' }, 415);
      }

      if (!mediaUrls.length) {
        return jsonResponse({ error: 'At least one mediaUrl is required' }, 400);
      }

      const allowedMediaTypes = new Set<MessageType>(['image', 'document', 'audio', 'video']);
      const mediaType =
        requestedType && allowedMediaTypes.has(requestedType as MessageType)
          ? (requestedType as MessageType)
          : undefined;

      try {
        getOrCreateConversation(normalizedId);
        const restaurant = auth.type === 'pat'
          ? await getRestaurantById(auth.restaurantId!)
          : await resolveRestaurantContext(normalizedId);
        if (!restaurant) {
          return jsonResponse({ error: 'Restaurant context not found for conversation' }, 404);
        }
        const twilioClient = await twilioClientManager.getClient(restaurant.id);
        if (!twilioClient) {
          return jsonResponse({ error: 'Twilio client not configured for this restaurant' }, 500);
        }
        const fromNumber = restaurant.whatsappNumber || TWILIO_WHATSAPP_FROM;
        if (!fromNumber) {
          return jsonResponse({ error: 'Restaurant WhatsApp number not configured' }, 500);
        }

        const conversationRecord = await findOrCreateConversation(restaurant.id, normalizedId);

        const { message: twilioMessage, messageType: outboundType } = await sendMediaMessage(
          twilioClient,
          fromNumber,
          normalizedId,
          {
          mediaUrls,
          caption,
          messageType: mediaType,
        }
        );

        try {
          const record = await createOutboundMessage({
            conversationId: conversationRecord.id,
            restaurantId: restaurant.id,
            fromPhone: fromNumber,
            toPhone: normalizedId,
            messageType: outboundType,
            content: caption || `[media:${outboundType}]`,
            mediaUrl: mediaUrls[0],
            metadata: mediaUrls.length > 1 ? { mediaUrls } : undefined,
          });
          if (twilioMessage?.sid) {
            await updateMessageWithSid(record.id, twilioMessage.sid);
          }
          await updateDbConversation(conversationRecord.id, {
            lastMessageAt: new Date(),
            unreadCount: 0,
          });
        } catch (logError) {
          console.error('⚠️ Failed to persist outbound media log:', logError);
        }
        markStoredConversationRead(normalizedId);
        setConversationData(normalizedId, { status: 'active', isBotActive: true });
        const messages = getStoredConversationMessages(normalizedId);
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage) {
          return jsonResponse({ message: null }, 202);
        }
        return jsonResponse({ message: mapMessageToApi(lastMessage) });
      } catch (error) {
        console.error('❌ Failed to send media message:', error);
        return jsonResponse({ error: 'Failed to send media message' }, 500);
      }
    }

    const toggleBotMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/toggle-bot$/);
    if (toggleBotMatch) {
      const auth = authenticate(req);
      if (!auth.ok) {
        const status = auth.error?.includes('required') ? 400 : 401;
        return jsonResponse({ error: auth.error || 'Unauthorized' }, status);
      }
      const conversationIdRaw = toggleBotMatch[1];
      if (!conversationIdRaw) {
        return jsonResponse({ error: 'Conversation id required' }, 400);
      }
      const normalizedId = normalizePhoneNumber(decodeURIComponent(conversationIdRaw));
      const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
      if (typeof body.enabled !== 'boolean') {
        return jsonResponse({ error: '`enabled` boolean is required' }, 400);
      }

      try {
        await updateDbConversation(normalizedId, { isBotActive: body.enabled });
        setConversationData(normalizedId, { isBotActive: body.enabled });
        console.log(`🤖 Bot for conversation ${normalizedId} set to: ${body.enabled}`);
        return jsonResponse({ success: true, isBotActive: body.enabled });
      } catch (error) {
        console.error('❌ Failed to toggle bot status:', error);
        return jsonResponse({ error: 'Failed to update bot status' }, 500);
      }
    }
  }

  return null;
}
