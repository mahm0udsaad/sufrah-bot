/**
 * Conversations API for dashboard
 * Provides conversation summaries, transcripts, and management
 */

import { jsonResponse } from '../../http';
import { DASHBOARD_PAT, BOT_API_KEY } from '../../../config';
import { prisma } from '../../../db/client';
import { getConversationSummary } from '../../../services/dashboardMetrics';
import { getLocaleFromRequest, createLocalizedResponse, t, formatRelativeTime } from '../../../services/i18n';

type AuthResult = { ok: boolean; restaurantId?: string; isAdmin?: boolean; error?: string };

function authenticate(req: Request): AuthResult {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';

  let token = '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearer && bearer[1]) token = bearer[1].trim();

  if (DASHBOARD_PAT && token && token === DASHBOARD_PAT) {
    const restaurantId = (req.headers.get('x-restaurant-id') || '').trim();
    if (!restaurantId) {
      return { ok: false, error: 'X-Restaurant-Id header is required' };
    }
    return { ok: true, restaurantId };
  }

  if (BOT_API_KEY && apiKeyHeader && apiKeyHeader === BOT_API_KEY) {
    return { ok: true, isAdmin: true };
  }

  return { ok: false, error: 'Unauthorized' };
}

/**
 * Handle GET /api/conversations/summary
 * Returns paginated conversation summaries with SLA info
 */
export async function handleConversationsApi(req: Request, url: URL): Promise<Response | null> {
  // GET /api/conversations/summary
  if (url.pathname === '/api/conversations/summary' && req.method === 'GET') {
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const summary = await getConversationSummary(auth.restaurantId, limit, offset);

    // Add localized data
    const localizedConversations = summary.conversations.map((conv) => ({
      ...conv,
      channelDisplay: t(`conversation.channel.${conv.channel}`, locale),
      escalatedDisplay: conv.escalated ? t('conversation.escalated', locale) : null,
      lastMessageRelative: formatRelativeTime(conv.lastMessageAt, locale),
    }));

    return jsonResponse(
      createLocalizedResponse(
        {
          ...summary,
          conversations: localizedConversations,
        },
        locale
      )
    );
  }

  // GET /api/conversations/:id/transcript
  const transcriptMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/transcript$/);
  if (transcriptMatch && req.method === 'GET') {
    const conversationId = transcriptMatch[1];
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const locale = getLocaleFromRequest(req);

    // Verify conversation belongs to restaurant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        restaurantId: auth.restaurantId,
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      return jsonResponse({ error: 'Conversation not found' }, 404);
    }

    const transcript = conversation.messages.map((msg) => ({
      id: msg.id,
      direction: msg.direction,
      messageType: msg.messageType,
      content: msg.content,
      mediaUrl: msg.mediaUrl,
      createdAt: msg.createdAt.toISOString(),
      createdAtRelative: formatRelativeTime(msg.createdAt, locale),
    }));

    return jsonResponse(
      createLocalizedResponse(
        {
          conversationId: conversation.id,
          customerWa: conversation.customerWa,
          customerName: conversation.customerName,
          status: conversation.status,
          messageCount: transcript.length,
          messages: transcript,
        },
        locale
      )
    );
  }

  // GET /api/conversations/:id/export
  const exportMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/export$/);
  if (exportMatch && req.method === 'GET') {
    const conversationId = exportMatch[1];
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Verify conversation belongs to restaurant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        restaurantId: auth.restaurantId,
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      return jsonResponse({ error: 'Conversation not found' }, 404);
    }

    // Generate text transcript
    const lines: string[] = [
      `Conversation Transcript`,
      `Customer: ${conversation.customerName || 'Unknown'} (${conversation.customerWa})`,
      `Status: ${conversation.status}`,
      `Created: ${conversation.createdAt.toISOString()}`,
      `Last Message: ${conversation.lastMessageAt.toISOString()}`,
      ``,
      `Messages:`,
      `--------`,
      ``,
    ];

    conversation.messages.forEach((msg) => {
      const direction = msg.direction === 'IN' ? 'Customer' : 'Restaurant';
      const timestamp = msg.createdAt.toISOString();
      lines.push(`[${timestamp}] ${direction}: ${msg.content}`);
      if (msg.mediaUrl) {
        lines.push(`  Media: ${msg.mediaUrl}`);
      }
      lines.push('');
    });

    const content = lines.join('\n');

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="conversation-${conversationId}.txt"`,
      },
    });
  }

  // PATCH /api/conversations/:id - update conversation settings
  const updateMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
  if (updateMatch && req.method === 'PATCH') {
    const conversationId = updateMatch[1];
    const auth = authenticate(req);
    if (!auth.ok || !auth.restaurantId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = await req.json();
    const locale = getLocaleFromRequest(req);

    // Verify conversation belongs to restaurant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        restaurantId: auth.restaurantId,
      },
    });

    if (!conversation) {
      return jsonResponse({ error: 'Conversation not found' }, 404);
    }

    const updateData: any = {};

    if (typeof body.isBotActive === 'boolean') {
      updateData.isBotActive = body.isBotActive;
    }

    if (body.status && ['active', 'closed'].includes(body.status)) {
      updateData.status = body.status;
    }

    if (typeof body.unreadCount === 'number') {
      updateData.unreadCount = Math.max(0, body.unreadCount);
    }

    if (Object.keys(updateData).length === 0) {
      return jsonResponse({ error: 'No valid fields to update' }, 400);
    }

    const updated = await prisma.conversation.update({
      where: { id: conversationId },
      data: updateData,
    });

    return jsonResponse(
      createLocalizedResponse(
        {
          conversationId: updated.id,
          updated: true,
          changes: updateData,
        },
        locale
      )
    );
  }

  return null;
}
