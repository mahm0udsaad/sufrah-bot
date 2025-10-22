import { jsonResponse, baseHeaders } from '../../../server/http';
import { WHATSAPP_SEND_TOKEN, TWILIO_WHATSAPP_FROM, WHATSAPP_SEND_QUEUE_ENABLED } from '../../../config';
import { standardizeWhatsappNumber } from '../../../utils/phone';
import { getRestaurantByWhatsapp } from '../../../db/sufrahRestaurantService';
import { TwilioClientManager } from '../../../twilio/clientManager';
import { sendNotification } from '../../../services/whatsapp';
import { checkQuota, formatQuotaError } from '../../../services/quotaEnforcement';
import { enqueueWhatsAppSend } from '../../../redis/whatsappSendQueue';
import { findOrCreateConversation } from '../../../db/conversationService';

const clientManager = new TwilioClientManager();

export async function handleWhatsAppSend(req: Request, url: URL): Promise<Response | null> {
  // Normalize path to tolerate a trailing slash
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  if (normalizedPath !== '/api/whatsapp/send') {
    return null;
  }

  // Allow both GET and POST for easier integration from external dashboards
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed', expected: 'GET or POST' }), {
      status: 405,
      headers: { ...baseHeaders, Allow: 'GET, POST, OPTIONS' },
    });
  }

  if (!WHATSAPP_SEND_TOKEN) {
    console.error('❌ WHATSAPP_SEND_TOKEN is not configured');
    return jsonResponse({ error: 'Messaging endpoint is disabled' }, 503);
  }

  const authHeader = req.headers.get('authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.*)$/i) as RegExpMatchArray | null;
  const providedToken = bearerMatch?.[1]?.trim() ?? '';

  if (!providedToken || providedToken !== WHATSAPP_SEND_TOKEN) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let rawPhone = '';
  let messageText = '';
  let fromPhoneRaw = '';
  let templateVariables: Record<string, any> | undefined = undefined;

  if (req.method === 'GET') {
    // Prefer query parameters
    rawPhone = (url.searchParams.get('phoneNumber') || '').trim();
    messageText = (url.searchParams.get('text') || '').trim();
    fromPhoneRaw = (url.searchParams.get('fromNumber') || '').trim();
    const templateParam = url.searchParams.get('templateVariables');
    if (templateParam) {
      try {
        const parsed = JSON.parse(templateParam);
        if (parsed && typeof parsed === 'object') templateVariables = parsed as Record<string, any>;
      } catch {
        // ignore malformed templateVariables for GET
      }
    }

    // Fallback: allow JSON body on GET for clients that send body with GET
    if (!rawPhone || !messageText) {
      const contentType = req.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const body = (await req.json().catch(() => ({}))) as {
          phoneNumber?: unknown;
          text?: unknown;
          templateVariables?: unknown;
          fromNumber?: unknown;
        };
        rawPhone = rawPhone || (typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : '');
        messageText = messageText || (typeof body.text === 'string' ? body.text.trim() : '');
        fromPhoneRaw = fromPhoneRaw || (typeof body.fromNumber === 'string' ? body.fromNumber.trim() : '');
        if (!templateVariables && body && typeof body === 'object' && body !== null && typeof (body as any).templateVariables === 'object' && (body as any).templateVariables !== null) {
          templateVariables = (body as any).templateVariables as Record<string, any>;
        }
      }
    }
  } else {
    const body = (await req.json().catch(() => ({}))) as {
      phoneNumber?: unknown;
      text?: unknown;
      templateVariables?: unknown;
      fromNumber?: unknown;
    };
    rawPhone = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : '';
    messageText = typeof body.text === 'string' ? body.text.trim() : '';
    fromPhoneRaw = typeof body.fromNumber === 'string' ? body.fromNumber.trim() : '';
    templateVariables = body && typeof body === 'object' && body !== null && typeof (body as any).templateVariables === 'object' && (body as any).templateVariables !== null
      ? (body as any).templateVariables as Record<string, any>
      : undefined;
  }

  if (!rawPhone) {
    return jsonResponse({ error: '`phoneNumber` is required' }, 400);
  }

  if (!messageText) {
    return jsonResponse({ error: '`text` is required' }, 400);
  }

  const standardizedPhone = standardizeWhatsappNumber(rawPhone);
  if (!standardizedPhone) {
    return jsonResponse({ error: 'Invalid phone number' }, 400);
  }

  if (!TWILIO_WHATSAPP_FROM) {
    console.error('❌ TWILIO_WHATSAPP_FROM is not configured');
    return jsonResponse({ error: 'Messaging channel is not configured' }, 500);
  }

  const fromNumber = standardizeWhatsappNumber(fromPhoneRaw) || TWILIO_WHATSAPP_FROM;
  
  // Try to get restaurant-specific client, but allow fallback to global client
  const restaurant = await getRestaurantByWhatsapp(fromNumber);
  
  // Check quota if restaurant is found
  if (restaurant) {
    try {
      const quotaCheck = await checkQuota(restaurant.id);
      
      if (!quotaCheck.allowed) {
        console.warn(`⚠️ Quota exceeded for restaurant ${restaurant.id}: ${quotaCheck.used}/${quotaCheck.limit} conversations used`);
        return jsonResponse(formatQuotaError(quotaCheck), 429); // 429 Too Many Requests
      }
      
      // Log if nearing quota (90%+)
      if (quotaCheck.limit > 0) {
        const usagePercent = (quotaCheck.used / quotaCheck.limit) * 100;
        if (usagePercent >= 90) {
          console.warn(`⚠️ Restaurant ${restaurant.id} is at ${usagePercent.toFixed(1)}% quota usage (${quotaCheck.used}/${quotaCheck.limit})`);
        }
      }
    } catch (error) {
      console.error('❌ Error checking quota:', error);
      // Continue with sending - don't block on quota check errors
    }
  }
  
  // If queue is enabled, enqueue the message instead of sending immediately
  if (WHATSAPP_SEND_QUEUE_ENABLED && restaurant) {
    try {
      // Find or create conversation for this customer
      const conversation = await findOrCreateConversation(
        restaurant.id,
        standardizedPhone,
        'unknown' // Profile name unknown for outbound
      );
      
      // Enqueue the send operation with FIFO guarantee per conversation
      const job = await enqueueWhatsAppSend({
        restaurantId: restaurant.id,
        conversationId: conversation.id,
        phoneNumber: standardizedPhone,
        text: messageText,
        fromNumber,
        templateVariables,
      });
      
      console.log(`📤 [API] Enqueued WhatsApp send job ${job.id} for restaurant ${restaurant.id}`);
      
      return jsonResponse({
        status: 'queued',
        message: 'Message queued for delivery',
        jobId: job.id,
        queuePosition: await job.getState(),
      });
    } catch (error) {
      console.error('❌ Failed to enqueue WhatsApp message:', error);
      // Fall back to direct send on queue failure
      console.log('⚠️ Falling back to direct send');
    }
  }
  
  // Direct send (fallback or when queue disabled)
  let twilioClient;
  if (restaurant) {
    // Use restaurant-specific client
    twilioClient = await clientManager.getClient(restaurant.id);
  } else {
    // Use global/master client as fallback
    console.log(`ℹ️ No restaurant found for ${fromNumber}, using global Twilio client`);
    twilioClient = clientManager.getGlobalClient();
  }
  
  if (!twilioClient) {
    return jsonResponse({ 
      error: 'Twilio client not available. Please configure TWILIO_MASTER_SID and TWILIO_MASTER_AUTH or associate the sending number with a restaurant.' 
    }, 500);
  }

  try {
    const result = await sendNotification(twilioClient, standardizedPhone, messageText, {
      fromNumber,
      templateVariables,
    });

    // Track usage for direct send (non-queued path)
    if (restaurant) {
      try {
        const { trackUsage } = await import('../../../services/usageTracking');
        const { findOrCreateConversation } = await import('../../../db/conversationService');
        
        const conversation = await findOrCreateConversation(
          restaurant.id,
          standardizedPhone,
          'unknown'
        );
        
        await trackUsage({
          restaurantId: restaurant.id,
          conversationId: conversation.id,
          eventType: 'outbound_direct',
        });
        
        console.log(`📊 [Direct Send] Tracked usage for restaurant ${restaurant.id}`);
      } catch (trackError) {
        console.error('❌ Failed to track direct send usage:', trackError);
        // Don't fail the send if tracking fails
      }
    }

    return jsonResponse({
      status: 'ok',
      message: 'Successfully sent',
      channel: result.channel,
      sid: result.sid,
    });
  } catch (error) {
    console.error('❌ Failed to send WhatsApp message via /api/whatsapp/send:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
    return jsonResponse({ error: errorMessage }, 500);
  }
}


