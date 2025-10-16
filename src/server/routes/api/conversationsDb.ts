import { jsonResponse } from '../../http';
import { prisma } from '../../../db/client';
import { listConversations, getConversationById, markConversationRead as markDbConversationRead } from '../../../db/conversationService';
import { listMessages } from '../../../db/messageService';
import { DASHBOARD_PAT } from '../../../config';

/**
 * NEW DATABASE-BACKED CONVERSATION API
 * This reads from PostgreSQL database instead of in-memory cache
 * Use this for dashboard data fetching to persist across server restarts
 */

interface ConversationApiResponse {
  id: string;
  restaurantId: string;
  customerPhone: string;
  customerName: string | null;
  status: string;
  lastMessageAt: string;
  unreadCount: number;
  isBotActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MessageApiResponse {
  id: string;
  conversationId: string;
  restaurantId: string;
  direction: 'IN' | 'OUT';
  messageType: string;
  content: string;
  mediaUrl: string | null;
  waSid: string | null;
  createdAt: string;
  metadata?: any;
}

function authenticate(req: Request): { ok: boolean; restaurantId?: string; error?: string } {
  const authHeader = req.headers.get('authorization') || '';
  const restaurantIdHeader = req.headers.get('x-restaurant-id') || '';

  let token = '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearer && bearer[1]) token = bearer[1].trim();

  if (DASHBOARD_PAT && token && token === DASHBOARD_PAT) {
    if (!restaurantIdHeader) {
      return { ok: false, error: 'X-Restaurant-Id header is required' };
    }
    return { ok: true, restaurantId: restaurantIdHeader };
  }

  return { ok: false, error: 'Unauthorized' };
}

export async function handleConversationsDbApi(req: Request, url: URL): Promise<Response | null> {
  // Only handle /api/db/* endpoints
  if (!url.pathname.startsWith('/api/db/')) {
    return null;
  }

  const auth = authenticate(req);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error || 'Unauthorized' }, auth.error?.includes('required') ? 400 : 401);
  }

  const restaurantId = auth.restaurantId!;

  // GET /api/db/conversations - List all conversations for restaurant
  if (req.method === 'GET' && url.pathname === '/api/db/conversations') {
    try {
      const status = url.searchParams.get('status') as 'active' | 'closed' | null;
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);

      const conversations = await listConversations(restaurantId, {
        status: status || undefined,
        limit,
        offset,
      });

      const response: ConversationApiResponse[] = conversations.map((conv) => ({
        id: conv.id,
        restaurantId: conv.restaurantId,
        customerPhone: conv.customerWa,
        customerName: conv.customerName,
        status: conv.status,
        lastMessageAt: conv.lastMessageAt.toISOString(),
        unreadCount: conv.unreadCount,
        isBotActive: conv.isBotActive,
        createdAt: conv.createdAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
      }));

      return jsonResponse(response);
    } catch (error) {
      console.error('❌ Failed to list conversations from DB:', error);
      return jsonResponse({ error: 'Failed to fetch conversations' }, 500);
    }
  }

  // GET /api/db/conversations/:id - Get specific conversation
  const getConvMatch = url.pathname.match(/^\/api\/db\/conversations\/([^/]+)$/);
  if (getConvMatch && req.method === 'GET') {
    const [, conversationId] = getConvMatch;
    try {
      const conversation = await getConversationById(conversationId);

      if (!conversation) {
        return jsonResponse({ error: 'Conversation not found' }, 404);
      }

      // Security: ensure conversation belongs to the authenticated restaurant
      if (conversation.restaurantId !== restaurantId) {
        return jsonResponse({ error: 'Access denied' }, 403);
      }

      const response: ConversationApiResponse = {
        id: conversation.id,
        restaurantId: conversation.restaurantId,
        customerPhone: conversation.customerWa,
        customerName: conversation.customerName,
        status: conversation.status,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        unreadCount: conversation.unreadCount,
        isBotActive: conversation.isBotActive,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      };

      return jsonResponse(response);
    } catch (error) {
      console.error(`❌ Failed to get conversation ${conversationId} from DB:`, error);
      return jsonResponse({ error: 'Failed to fetch conversation' }, 500);
    }
  }

  // GET /api/db/conversations/:id/messages - Get messages for conversation
  const getMessagesMatch = url.pathname.match(/^\/api\/db\/conversations\/([^/]+)\/messages$/);
  if (getMessagesMatch && req.method === 'GET') {
    const [, conversationId] = getMessagesMatch;
    try {
      // Verify conversation exists and belongs to restaurant
      const conversation = await getConversationById(conversationId);
      if (!conversation) {
        return jsonResponse({ error: 'Conversation not found' }, 404);
      }
      if (conversation.restaurantId !== restaurantId) {
        return jsonResponse({ error: 'Access denied' }, 403);
      }

      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);

      const messages = await listMessages(conversationId, { limit, offset });

      const response: MessageApiResponse[] = messages.map((msg) => ({
        id: msg.id,
        conversationId: msg.conversationId,
        restaurantId: msg.restaurantId,
        direction: msg.direction,
        messageType: msg.messageType,
        content: msg.content,
        mediaUrl: msg.mediaUrl,
        waSid: msg.waSid,
        createdAt: msg.createdAt.toISOString(),
        metadata: msg.metadata,
      }));

      // Mark conversation as read when messages are fetched
      await markDbConversationRead(conversationId).catch((err) => {
        console.error('⚠️ Failed to mark conversation as read:', err);
      });

      return jsonResponse(response);
    } catch (error) {
      console.error(`❌ Failed to get messages for conversation ${conversationId} from DB:`, error);
      return jsonResponse({ error: 'Failed to fetch messages' }, 500);
    }
  }

  // GET /api/db/conversations/stats - Get statistics
  if (req.method === 'GET' && url.pathname === '/api/db/conversations/stats') {
    try {
      const [totalConversations, activeConversations, unreadCount] = await Promise.all([
        prisma.conversation.count({ where: { restaurantId } }),
        prisma.conversation.count({ where: { restaurantId, status: 'active' } }),
        prisma.conversation.aggregate({
          where: { restaurantId },
          _sum: { unreadCount: true },
        }),
      ]);

      return jsonResponse({
        totalConversations,
        activeConversations,
        totalUnread: unreadCount._sum.unreadCount || 0,
      });
    } catch (error) {
      console.error('❌ Failed to get conversation stats from DB:', error);
      return jsonResponse({ error: 'Failed to fetch stats' }, 500);
    }
  }

  // GET /api/db/restaurants/:restaurantId/bots - Get all bots for a restaurant
  const getBotsMatch = url.pathname.match(/^\/api\/db\/restaurants\/([^/]+)\/bots$/);
  if (getBotsMatch && req.method === 'GET') {
    const [, requestedRestaurantId] = getBotsMatch;
    
    // Security check: ensure requesting their own restaurant
    if (requestedRestaurantId !== restaurantId) {
      return jsonResponse({ error: 'Access denied' }, 403);
    }

    try {
      const bots = await prisma.restaurantBot.findMany({
        where: { restaurantId },
        select: {
          id: true,
          name: true,
          restaurantName: true,
          whatsappNumber: true,
          status: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return jsonResponse(bots);
    } catch (error) {
      console.error('❌ Failed to get bots from DB:', error);
      return jsonResponse({ error: 'Failed to fetch bots' }, 500);
    }
  }

  return null;
}

