/**
 * Multi-tenant inbound webhook handler
 * Routes messages by "To" number → RestaurantBot
 * Enforces idempotency, rate limiting, and signature validation
 */

import { findRestaurantByWhatsAppNumber } from '../db/restaurantService';
import { findOrCreateConversation, updateConversation } from '../db/conversationService';
import { createInboundMessage, messageExists } from '../db/messageService';
import { logWebhookRequest } from '../db/webhookService';
import { eventBus } from '../redis/eventBus';
import { tryAcquireIdempotencyLock } from '../utils/idempotency';
import { checkRestaurantRateLimit, checkCustomerRateLimit } from '../utils/rateLimiter';
import { validateTwilioSignature, extractTwilioSignature } from '../utils/twilioSignature';
import { normalizePhoneNumber } from '../utils/phone';
import { consumeCachedMessageForPhone, sendNotification } from '../services/whatsapp';

export interface InboundWebhookPayload {
  From: string; // Customer WhatsApp number
  To: string; // Restaurant WhatsApp number
  Body?: string;
  MessageSid?: string;
  ProfileName?: string;
  Latitude?: string;
  Longitude?: string;
  Address?: string;
  NumMedia?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
  ButtonPayload?: string; // Quick reply button ID
  ButtonText?: string; // Quick reply button text
}

export interface ProcessedWebhookResult {
  success: boolean;
  restaurantId?: string;
  conversationId?: string;
  messageId?: string;
  error?: string;
  statusCode: number;
}

/**
 * Process an inbound Twilio webhook
 */
export async function processInboundWebhook(
  payload: InboundWebhookPayload,
  requestUrl: string,
  signature: string | null,
  requestId: string
): Promise<ProcessedWebhookResult> {
  const { From, To, Body, MessageSid, ProfileName, Latitude, Longitude, Address, ButtonPayload, ButtonText } = payload;

  try {
    // Step 0: Detect quick reply button clicks (view_order button) - handling deferred until after conversation is established
    const isViewOrderRequest = 
      ButtonPayload === 'view_order' || 
      Body === 'View Order Details' ||
      ButtonText === 'View Order Details';
    
    // Step 1: Route by "To" number → RestaurantBot
    const restaurant = await findRestaurantByWhatsAppNumber(To);
    if (!restaurant) {
      console.warn(`⚠️ No restaurant found for WhatsApp number: ${To}`);
      await logWebhookRequest({
        requestId,
        method: 'POST',
        path: '/whatsapp/webhook',
        body: payload,
        statusCode: 404,
        errorMessage: `No restaurant found for number: ${To}`,
      });
      return { success: false, error: 'Restaurant not found', statusCode: 404 };
    }

    console.log(`📍 Routed to restaurant: ${restaurant.name} (${restaurant.id})`);

    // Step 2: Validate Twilio signature
    if (signature) {
      const isValid = validateTwilioSignature(
        restaurant.twilioAuthToken,
        signature,
        requestUrl,
        payload
      );
      if (!isValid) {
        console.warn(`⚠️ Invalid Twilio signature for restaurant ${restaurant.id}`);
        await logWebhookRequest({
          restaurantId: restaurant.id,
          requestId,
          method: 'POST',
          path: '/whatsapp/webhook',
          body: payload,
          statusCode: 403,
          errorMessage: 'Invalid Twilio signature',
        });
        return { success: false, error: 'Invalid signature', statusCode: 403 };
      }
    }

    // Step 3: Idempotency check - prevent duplicate processing
    if (MessageSid) {
      const alreadyProcessed = await messageExists(MessageSid);
      if (alreadyProcessed) {
        console.log(`⏭️ Duplicate webhook detected (MessageSid: ${MessageSid}), skipping`);
        return {
          success: true,
          restaurantId: restaurant.id,
          statusCode: 200,
        };
      }

      // Try to acquire idempotency lock
      const acquired = await tryAcquireIdempotencyLock(`msg:${MessageSid}`);
      if (!acquired) {
        console.log(`⏭️ Message ${MessageSid} is being processed by another worker`);
        return { success: true, restaurantId: restaurant.id, statusCode: 200 };
      }
    }

    // Step 4: Rate limiting - per restaurant and per customer
    const customerPhone = normalizePhoneNumber(From);

    const restaurantLimit = await checkRestaurantRateLimit(
      restaurant.id,
      restaurant.maxMessagesPerMin
    );
    if (!restaurantLimit.allowed) {
      console.warn(`⚠️ Restaurant ${restaurant.id} rate limit exceeded`);
      await logWebhookRequest({
        restaurantId: restaurant.id,
        requestId,
        method: 'POST',
        path: '/whatsapp/webhook',
        body: payload,
        statusCode: 429,
        errorMessage: 'Restaurant rate limit exceeded',
      });
      return { success: false, error: 'Rate limit exceeded', statusCode: 429 };
    }

    const customerLimit = await checkCustomerRateLimit(restaurant.id, customerPhone);
    if (!customerLimit.allowed) {
      console.warn(`⚠️ Customer ${customerPhone} rate limit exceeded for restaurant ${restaurant.id}`);
      return { success: false, error: 'Customer rate limit exceeded', statusCode: 429 };
    }

    // Step 5: Find or create conversation
    const conversation = await findOrCreateConversation(
      restaurant.id,
      customerPhone,
      ProfileName
    );

    console.log(`💬 Conversation: ${conversation.id}`);

    // Step 6: Determine message type and content
    let messageType = 'text';
    let content = Body || '';
    let mediaUrl: string | undefined;
    const metadata: any = {};

    // If this is a button response (including "view_order"), handle it now after conversation is established
    const isButtonResponse = Boolean(ButtonPayload || ButtonText);
    if (isViewOrderRequest) {
      console.log(`🔘 [ButtonClick] User requested "View Order Details" from ${From}`);

      // Persist an inbound message for session window tracking (but mark as a button response)
      try {
        await createInboundMessage({
          conversationId: conversation.id,
          restaurantId: restaurant.id,
          waSid: MessageSid,
          fromPhone: customerPhone,
          toPhone: normalizePhoneNumber(To),
          messageType: 'button',
          content: ButtonText || Body || 'View Order Details',
          metadata: { buttonPayload: ButtonPayload, buttonText: ButtonText, isButtonResponse: true },
        });
        await updateConversation(conversation.id, {
          lastMessageAt: new Date(),
        });
      } catch (persistErr) {
        console.warn('⚠️ [ButtonClick] Failed to persist inbound button message (continuing):', persistErr);
      }

      // Retrieve cached message (and mark delivered)
      const cachedMessage = await consumeCachedMessageForPhone(From);

      if (cachedMessage) {
        console.log(`📤 [ButtonClick] Sending cached order details to ${From} (freeform - button opened 24h window)`);
        try {
          // Button click opens 24h window - force freeform sending
          await sendNotification(From, cachedMessage, { fromNumber: To, forceFreeform: true });
          console.log(`✅ [ButtonClick] Successfully sent cached message to ${From}`);
          await logWebhookRequest({
            restaurantId: restaurant.id,
            requestId,
            method: 'POST',
            path: '/whatsapp/webhook',
            body: payload,
            statusCode: 200,
          });
          return { success: true, restaurantId: restaurant.id, statusCode: 200 };
        } catch (error: any) {
          console.error(`❌ [ButtonClick] Failed to send cached message to ${From}:`, error);
          await logWebhookRequest({
            restaurantId: restaurant.id,
            requestId,
            method: 'POST',
            path: '/whatsapp/webhook',
            body: payload,
            statusCode: 500,
            errorMessage: `Failed to send cached message: ${error.message}`,
          });
          return { success: false, restaurantId: restaurant.id, error: 'Failed to send cached message', statusCode: 500 };
        }
      } else {
        console.warn(`⚠️ [ButtonClick] No cached message found for ${From}`);
        try {
          // Send fallback as freeform (button click opened 24h window)
          await sendNotification(From, 'Sorry, order details are no longer available. Please contact support.', { fromNumber: To, forceFreeform: true });
        } catch (error) {
          console.error(`❌ [ButtonClick] Failed to send fallback message:`, error);
        }
        await logWebhookRequest({
          restaurantId: restaurant.id,
          requestId,
          method: 'POST',
          path: '/whatsapp/webhook',
          body: payload,
          statusCode: 404,
          errorMessage: 'No cached message found',
        });
        return { success: false, restaurantId: restaurant.id, error: 'No cached message found', statusCode: 404 };
      }
    }

    // Handle location messages
    if (Latitude && Longitude) {
      messageType = 'location';
      content = Address || `📍 ${Latitude}, ${Longitude}`;
      metadata.location = { latitude: Latitude, longitude: Longitude, address: Address };
    }

    // Handle media messages
    if (payload.NumMedia && parseInt(payload.NumMedia, 10) > 0) {
      messageType = 'image'; // Can be extended for other media types
      mediaUrl = payload.MediaUrl0;
      metadata.mediaContentType = payload.MediaContentType0;
    }

    if (ProfileName) {
      metadata.profileName = ProfileName;
    }

    // Step 7: Persist message to database
    const message = await createInboundMessage({
      conversationId: conversation.id,
      restaurantId: restaurant.id,
      waSid: MessageSid,
      fromPhone: customerPhone,
      toPhone: normalizePhoneNumber(To),
      messageType,
      content,
      mediaUrl,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    if (!message) {
      // Message was a duplicate (caught by DB-level idempotency)
      return { success: true, restaurantId: restaurant.id, statusCode: 200 };
    }

    console.log(`✅ Message persisted: ${message.id}`);

    // Step 8: Update conversation lastMessageAt and unreadCount
    await updateConversation(conversation.id, {
      lastMessageAt: new Date(),
      unreadCount: conversation.unreadCount + 1,
    });

    // Step 9: Publish real-time event to dashboard (skip if button response)
    if (!isButtonResponse) {
      await eventBus.publishMessage(restaurant.id, {
        type: 'message.received',
        message: {
          id: message.id,
          conversationId: conversation.id,
          fromPhone: customerPhone,
          content,
          messageType,
          direction: 'IN',
          createdAt: message.createdAt,
        },
        conversation: {
          id: conversation.id,
          customerPhone,
          customerName: ProfileName || conversation.customerName,
          unreadCount: conversation.unreadCount + 1,
        },
      });
    } else {
      console.log(`🔘 [ButtonResponse] Skipping event bus publish for button response`);
    }

    // Step 10: Log webhook for audit
    await logWebhookRequest({
      restaurantId: restaurant.id,
      requestId,
      method: 'POST',
      path: '/whatsapp/webhook',
      body: payload,
      statusCode: 200,
    });

    return {
      success: true,
      restaurantId: restaurant.id,
      conversationId: conversation.id,
      messageId: message.id,
      statusCode: 200,
    };
  } catch (error: any) {
    console.error('❌ Error processing inbound webhook:', error);

    // Log the error
    try {
      await logWebhookRequest({
        requestId,
        method: 'POST',
        path: '/whatsapp/webhook',
        body: payload,
        statusCode: 500,
        errorMessage: error.message,
      });
    } catch (logError) {
      console.error('❌ Failed to log webhook error:', logError);
    }

    return {
      success: false,
      error: error.message,
      statusCode: 500,
    };
  }
}

