import { PORT } from './src/config';
import { seedCacheFromKey } from './src/workflows/cache';
import { mapConversationToApi, mapMessageToApi } from './src/workflows/mappers';
import { broadcast, notifyBotStatus } from './src/workflows/events';
import { getActiveCartsCount } from './src/state/orders';
import { getConversations, onMessageAppended, onConversationUpdated, setConversationData } from './src/state/conversations';

let welcomeContentSid = process.env.CONTENT_SID_WELCOME || '';

seedCacheFromKey('welcome', welcomeContentSid);
seedCacheFromKey('order_type', process.env.CONTENT_SID_ORDER_TYPE || '');
seedCacheFromKey('categories', process.env.CONTENT_SID_CATEGORIES || '');
seedCacheFromKey('post_item_choice', process.env.CONTENT_SID_POST_ITEM_CHOICE || '');
seedCacheFromKey('location_request', process.env.CONTENT_SID_LOCATION_REQUEST || '');
seedCacheFromKey('quantity_prompt', process.env.CONTENT_SID_QUANTITY || '');
seedCacheFromKey('cart_options', process.env.CONTENT_SID_CART_OPTIONS || '');
seedCacheFromKey('payment_options', process.env.CONTENT_SID_PAYMENT_OPTIONS || '');
seedCacheFromKey('branch_list', process.env.CONTENT_SID_BRANCH_LIST || '');
seedCacheFromKey('rating_list', process.env.CONTENT_SID_RATING_LIST || '');

import { baseHeaders, jsonResponse } from './src/server/http';
import { handleStatus } from './src/server/routes/status';
import { handleWhatsAppSend } from './src/server/routes/api/notify';
import { handleAdmin } from './src/server/routes/admin';
import { handleTwilioForm, handleVerify, handleMeta } from './src/server/routes/webhooks';
import { handleConversationsApi } from './src/server/routes/api/conversations';
import { handleConversationsDbApi } from './src/server/routes/api/conversationsDb';
import { handleRatingsApi } from './src/server/routes/api/ratings';
import { getGlobalBotEnabled, setGlobalBotEnabled, getWelcomedUsersCount } from './src/state/bot';

// Removed business logic helpers; they now live in dedicated modules

onMessageAppended((message) =>
  broadcast({ type: 'message.created', data: mapMessageToApi(message) })
);

onConversationUpdated((conversation) =>
  broadcast({ type: 'conversation.updated', data: mapConversationToApi(conversation) })
);

// Welcome message tracking moved to src/state/bot.ts
// processMessage and helpers moved to src/handlers/processMessage.ts

// Webhook server
const server = Bun.serve({
  port: PORT,
  async fetch(req: Request, server): Promise<Response> {
    const host = req.headers.get('host') ?? `localhost:${PORT}`;
    const url = new URL(req.url, `http://${host}`);
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: baseHeaders });
    }

    if (req.headers.get('upgrade') === 'websocket' && url.pathname === '/ws') {
      const success = server.upgrade(req);
      if (success) {
        return new Response(null, { status: 101 });
      }
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // Conversations API handled in module

    // Payment status webhook from Sufrah/Pay gateway
    const statusResponse = await handleStatus(req, url);
    if (statusResponse) return statusResponse;

    // WhatsApp send API endpoint
    const whatsappSendResponse = await handleWhatsAppSend(req, url);
    if (whatsappSendResponse) return whatsappSendResponse;

    if (req.method === 'POST' && url.pathname === '/api/bot/toggle') {
      const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
      if (typeof body.enabled !== 'boolean') {
        return jsonResponse({ error: '`enabled` boolean is required' }, 400);
      }
      setGlobalBotEnabled(body.enabled);
      getConversations().forEach((conversation) => {
        setConversationData(conversation.id, { isBotActive: getGlobalBotEnabled() });
      });
      notifyBotStatus(getGlobalBotEnabled());
      return jsonResponse({ enabled: getGlobalBotEnabled() });
    }
    
    // WhatsApp multi-tenant webhook (Twilio)
    const twilioFormResponse = await handleTwilioForm(req, url);
    if (twilioFormResponse) return twilioFormResponse;

    // Handle webhook verification
    const verifyResponse = await handleVerify(req, url);
    if (verifyResponse) return verifyResponse;

    // Handle webhook verification & Meta webhook
    const metaVerifyResponse = await handleVerify(req, url);
    if (metaVerifyResponse) return metaVerifyResponse;
    const metaResponse = await handleMeta(req, url);
    if (metaResponse) return metaResponse;

    // Database-backed Conversations API (use this for dashboard)
    const convDbResponse = await handleConversationsDbApi(req, url);
    if (convDbResponse) return convDbResponse;

    // Ratings API (for dashboard)
    const ratingsResponse = await handleRatingsApi(req, url);
    if (ratingsResponse) return ratingsResponse;

    // Conversations API (legacy in-memory)
    const convResponse = await handleConversationsApi(req, url);
    if (convResponse) return convResponse;

    // Admin routes
    const adminResponse = await handleAdmin(req, url);
    if (adminResponse) return adminResponse;

    // Health check endpoint
    if (req.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        welcomedUsers: getWelcomedUsersCount(),
        activeCarts: getActiveCartsCount(),
        botEnabled: getGlobalBotEnabled(),
      });
    }

    return new Response('Not Found', { status: 404 });
  },
  websocket: {
    async open(ws: Bun.ServerWebSocket<any>) {
      // lazy import to avoid circular deps at startup
      const { wsHandlers } = require('./src/server/ws');
      // send bot status after bootstrap
      await wsHandlers.open(ws);
      ws.send(JSON.stringify({ type: 'bot.status', data: { enabled: getGlobalBotEnabled() } }));
    },
    close(ws: Bun.ServerWebSocket<any>) {
      const { wsHandlers } = require('./src/server/ws');
      wsHandlers.close(ws);
    },
    message(ws: Bun.ServerWebSocket<any>, message: string | Uint8Array) {
      const { wsHandlers } = require('./src/server/ws');
      wsHandlers.message(ws, message);
    },
  },
});
