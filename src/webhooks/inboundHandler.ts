/**
 * Multi-tenant inbound webhook handler
 * Routes messages by "To" number → RestaurantBot
 * Enforces idempotency, rate limiting, and signature validation
 */

import { prisma } from '../db/client';
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
import { notifyConversationStarted } from '../services/notificationFeed';
import { TwilioClientManager } from '../twilio/clientManager';
import { processMessage } from '../handlers/processMessage';

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
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔔 [Webhook] Processing inbound message`);
    console.log(`   From: ${From}`);
    console.log(`   To: ${To}`);
    console.log(`   Body: ${Body || '(empty)'}`);
    console.log(`   MessageSid: ${MessageSid || '(none)'}`);
    console.log(`   ButtonPayload: ${ButtonPayload || '(none)'}`);
    console.log(`   ButtonText: ${ButtonText || '(none)'}`);
    console.log(`   ProfileName: ${ProfileName || '(none)'}`);
    
    // Step 0: Detect quick reply button clicks (view_order button) - handling deferred until after conversation is established
    const isViewOrderRequest = 
      ButtonPayload === 'view_order' || 
      Body === 'View Order Details' ||
      ButtonText === 'View Order Details';
    
    console.log(`   isViewOrderRequest: ${isViewOrderRequest}`);
    console.log(`${'='.repeat(80)}\n`);
    
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

    const restaurantName =
      restaurant.name ??
      (restaurant as any).restaurantName ??
      (restaurant as any).restaurant?.name ??
      'Restaurant';

    console.log(`📍 Routed to restaurant: ${restaurantName} (${restaurant.id})`);

    // Resolve the RestaurantProfile id (tenant id) early
    const restaurantProfileId =
      restaurant.restaurantId ??
      (restaurant as any).restaurant?.id ??
      restaurant.id;

    // Prepare Twilio client for outbound replies
    const clientManager = new TwilioClientManager();
    const twilioClient = await clientManager.getClient(restaurantProfileId);
    if (!twilioClient) {
      console.error(`❌ Twilio client not available for restaurant ${restaurantProfileId}`);
      return { success: false, error: 'Twilio client unavailable', statusCode: 500 };
    }

    // PRIORITY: Handle "View Order Details" button click IMMEDIATELY
    // This bypasses all normal flow (idempotency, rate limiting, bot automation)
    if (isViewOrderRequest) {
      console.log(`\n🔘 [ButtonClick] ENTERING VIEW ORDER REQUEST HANDLER`);
      console.log(`🔘 [ButtonClick] User clicked "View Order Details" from ${From} - handling immediately`);
      
      const customerPhone = normalizePhoneNumber(From);
      
      // Find or create minimal conversation for tracking
      let conversation;
      try {
        conversation = await findOrCreateConversation(
          restaurantProfileId,
          customerPhone,
          ProfileName
        );
      } catch (err) {
        console.warn('⚠️ [ButtonClick] Could not create conversation, continuing anyway:', err);
      }

      // Persist button click as inbound message (for 24h window tracking)
      if (conversation) {
        try {
          await createInboundMessage({
            conversationId: conversation.id,
            restaurantId: restaurantProfileId,
            waSid: MessageSid || `button_${Date.now()}`,
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
          console.warn('⚠️ [ButtonClick] Failed to persist button message:', persistErr);
        }
      }

      // Retrieve and send cached message
      const cachedMessage = await consumeCachedMessageForPhone(From);

      if (cachedMessage) {
        console.log(`📤 [ButtonClick] Sending cached order details to ${From}`);
        try {
          // Button click opens 24h window - force freeform sending
          await sendNotification(twilioClient, From, cachedMessage, { 
            fromNumber: To, 
            forceFreeform: true 
          });
          console.log(`✅ [ButtonClick] Successfully sent cached message to ${From}`);
          
          await logWebhookRequest({
            restaurantId: restaurantProfileId,
            requestId,
            method: 'POST',
            path: '/whatsapp/webhook',
            body: payload,
            statusCode: 200,
          });
          
          return { 
            success: true, 
            restaurantId: restaurantProfileId, 
            conversationId: conversation?.id,
            statusCode: 200 
          };
        } catch (error: any) {
          console.error(`❌ [ButtonClick] Failed to send cached message:`, error);
          
          await logWebhookRequest({
            restaurantId: restaurantProfileId,
            requestId,
            method: 'POST',
            path: '/whatsapp/webhook',
            body: payload,
            statusCode: 500,
            errorMessage: `Failed to send cached message: ${error.message}`,
          });
          
          return { 
            success: false, 
            restaurantId: restaurantProfileId, 
            error: 'Failed to send cached message', 
            statusCode: 500 
          };
        }
      } else {
        console.warn(`⚠️ [ButtonClick] No cached message found for ${From}`);
        
        // Send fallback message
        try {
          await sendNotification(
            twilioClient, 
            From, 
            'Sorry, order details are no longer available. Please contact support.', 
            { fromNumber: To, forceFreeform: true }
          );
          console.log(`📤 [ButtonClick] Sent fallback message to ${From}`);
        } catch (error) {
          console.error(`❌ [ButtonClick] Failed to send fallback:`, error);
        }
        
        await logWebhookRequest({
          restaurantId: restaurantProfileId,
          requestId,
          method: 'POST',
          path: '/whatsapp/webhook',
          body: payload,
          statusCode: 404,
          errorMessage: 'No cached message found',
        });
        
        return { 
          success: false, 
          restaurantId: restaurantProfileId, 
          error: 'No cached message found', 
          statusCode: 404 
        };
      }
    }

    console.log(`✅ [Flow] Button click handler skipped, continuing with normal message flow`);
    console.log(`✅ [Flow] Processing as regular message (not a view_order button)`);

    const twilioAuthToken =
      (restaurant as any).twilioAuthToken ??
      restaurant.authToken ??
      (restaurant as any).restaurant?.twilioAuthToken ??
      '';

    console.log(`🔐 [Step 2] Starting Twilio signature validation...`);
    console.log(`   Has signature: ${!!signature}`);
    console.log(`   Has auth token: ${!!twilioAuthToken}`);
    
    // Step 2: Validate Twilio signature
    if (signature && twilioAuthToken) {
      const isValid = validateTwilioSignature(
        twilioAuthToken,
        signature,
        requestUrl,
        payload
      );
      if (!isValid) {
        console.warn(`⚠️ Invalid Twilio signature for restaurant ${restaurantProfileId}`);
        await logWebhookRequest({
          restaurantId: restaurantProfileId,
          requestId,
          method: 'POST',
          path: '/whatsapp/webhook',
          body: payload,
          statusCode: 403,
          errorMessage: 'Invalid Twilio signature',
        });
        return { success: false, error: 'Invalid signature', statusCode: 403 };
      }
    } else if (signature && !twilioAuthToken) {
      console.warn(
        `⚠️ Twilio auth token unavailable for restaurant ${restaurantProfileId}; skipping signature validation`
      );
    }
    
    console.log(`✅ [Step 2] Signature validation passed/skipped`);

    console.log(`🔍 [Step 3] Starting idempotency check...`);
    console.log(`   MessageSid: ${MessageSid || 'none'}`);
    
    // Step 3: Idempotency check - prevent duplicate processing
    if (MessageSid) {
      console.log(`   [Idempotency] Checking DB for existing waSid: ${MessageSid}`);
      const alreadyProcessed = await messageExists(MessageSid);
      console.log(`   [Idempotency] messageExists=${alreadyProcessed}`);
      if (alreadyProcessed) {
        console.log(`⏭️ Duplicate webhook detected (MessageSid: ${MessageSid}), skipping`);
        return {
          success: true,
          restaurantId: restaurantProfileId,
          statusCode: 200,
        };
      }

      // Try to acquire idempotency lock
      console.log(`   [Idempotency] Trying to acquire lock for key msg:${MessageSid}`);
      const acquired = await tryAcquireIdempotencyLock(`msg:${MessageSid}`);
      console.log(`   [Idempotency] lock acquired=${acquired}`);
      if (!acquired) {
        const failOpen = (process.env.IDEMPOTENCY_FAIL_OPEN ?? 'true') !== 'false';
        console.warn(
          `⚠️ [Idempotency] Could not acquire lock for ${MessageSid}. failOpen=${failOpen}`
        );
        if (!failOpen) {
          console.log(`⏭️ Message ${MessageSid} treated as in-progress by another worker (strict mode)`);
          return { success: true, restaurantId: restaurantProfileId, statusCode: 200 };
        }
        console.warn(`⚠️ [Idempotency] Proceeding without lock (fail-open) to avoid stuck flow`);
      }
    }
    
    console.log(`✅ [Step 3] Idempotency check passed`);

    console.log(`🚦 [Step 4] Starting rate limit checks...`);
    
    // Step 4: Rate limiting - per restaurant and per customer
    const customerPhone = normalizePhoneNumber(From);
    console.log(`   Customer phone (normalized): ${customerPhone}`);

    const restaurantLimit = await checkRestaurantRateLimit(
      restaurantProfileId,
      restaurant.maxMessagesPerMin
    );
    if (!restaurantLimit.allowed) {
      console.warn(`⚠️ Restaurant ${restaurantProfileId} rate limit exceeded`);
      await logWebhookRequest({
        restaurantId: restaurantProfileId,
        requestId,
        method: 'POST',
        path: '/whatsapp/webhook',
        body: payload,
        statusCode: 429,
        errorMessage: 'Restaurant rate limit exceeded',
      });
      return { success: false, error: 'Rate limit exceeded', statusCode: 429 };
    }

    const customerLimit = await checkCustomerRateLimit(restaurantProfileId, customerPhone);
    if (!customerLimit.allowed) {
      console.warn(`⚠️ Customer ${customerPhone} rate limit exceeded for restaurant ${restaurantProfileId}`);
      return { success: false, error: 'Customer rate limit exceeded', statusCode: 429 };
    }
    
    console.log(`✅ [Step 4] Rate limit checks passed`);

    console.log(`💬 [Step 5] Finding or creating conversation...`);
    
    // Step 5: Find or create conversation
    const existingConversation = await prisma.conversation.findUnique({
      where: {
        restaurantId_customerWa: {
          restaurantId: restaurantProfileId,
          customerWa: customerPhone,
        },
      },
    });

    const conversation = await findOrCreateConversation(
      restaurantProfileId,
      customerPhone,
      ProfileName
    );

    console.log(`✅ [Step 5] Conversation: ${conversation.id}`);

    if (!existingConversation) {
      try {
        await notifyConversationStarted({
          restaurantId: restaurantProfileId,
          conversationId: conversation.id,
          customerName: ProfileName,
          customerPhone,
        });
      } catch (error) {
        console.error('❌ [Notifications] Failed to record conversation-start notification:', error);
      }
    }

    console.log(`📝 [Step 6] Determining message type and content...`);
    
    // Step 6: Determine message type and content
    let messageType = 'text';
    let content = Body || '';
    let mediaUrl: string | undefined;
    const metadata: any = {};

    // Note: view_order button is handled at the top of this function (lines 102-220)
    // and returns immediately, so it will never reach this point

    // Handle other button responses (not view_order)
    const isButtonResponse = Boolean(ButtonPayload || ButtonText);
    if (isButtonResponse) {
      messageType = 'interactive';
      content = ButtonPayload || Body || ButtonText || content;
      metadata.buttonPayload = ButtonPayload;
      metadata.buttonText = ButtonText;
      metadata.isButtonResponse = true;
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

    console.log(`💾 [Step 7] Persisting message to database...`);
    console.log(`   Message type: ${messageType}`);
    console.log(`   Content: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);
    
    // Step 7: Persist message to database
    const message = await createInboundMessage({
      conversationId: conversation.id,
      restaurantId: restaurantProfileId,
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
      console.log(`⏭️ [Step 7] Duplicate message detected at DB level, skipping`);
      return { success: true, restaurantId: restaurant.id, statusCode: 200 };
    }

    console.log(`✅ [Step 7] Message persisted: ${message.id}`);

    console.log(`🔄 [Step 8] Updating conversation...`);
    
    // Step 8: Update conversation lastMessageAt and unreadCount
    await updateConversation(conversation.id, {
      lastMessageAt: new Date(),
      unreadCount: conversation.unreadCount + 1,
    });
    
    console.log(`✅ [Step 8] Conversation updated`);

    console.log(`📡 [Step 9] Publishing event to dashboard...`);
    console.log(`   Is button response: ${isButtonResponse}`);
    
    // Step 9: Publish real-time event to dashboard (skip if button response)
    if (!isButtonResponse) {
      await eventBus.publishMessage(restaurantProfileId, {
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
      console.log(`✅ [Step 9] Event published to dashboard`);
    } else {
      console.log(`🔘 [ButtonResponse] Skipping event bus publish for button response`);
    }

    console.log(`✅ [Step 9] Event bus step completed`);
    
    // Step 10: Trigger bot automation (fire-and-wait)
    console.log(`\n🤖 [Bot Automation] Preparing to call processMessage()`);
    console.log(`   Customer: ${customerPhone}`);
    console.log(`   Content: ${content}`);
    console.log(`   Type: ${messageType}`);
    
    const automationPayload: Record<string, any> = {
      profileName: ProfileName,
      recipientPhone: To,
    };
    if (metadata.location) {
      automationPayload.location = metadata.location;
    }
    if (mediaUrl) {
      automationPayload.mediaUrl = mediaUrl;
    }
    if (isButtonResponse && !isViewOrderRequest) {
      automationPayload.buttonPayload = ButtonPayload;
      automationPayload.buttonText = ButtonText;
    }
    
    console.log(`   Payload keys: ${Object.keys(automationPayload).join(', ')}`);
    console.log(`🤖 [Bot Automation] Calling processMessage() now...`);
    
    try {
      await processMessage(customerPhone, content, messageType, automationPayload);
      console.log(`✅ [Bot Automation] processMessage() completed successfully`);
    } catch (automationError) {
      console.error('❌ [Bot Automation] Failed to run bot automation:', automationError);
      console.error('❌ [Bot Automation] Error stack:', (automationError as Error).stack);
    }

    // Step 11: Log webhook for audit
    await logWebhookRequest({
      restaurantId: restaurantProfileId,
      requestId,
      method: 'POST',
      path: '/whatsapp/webhook',
      body: payload,
      statusCode: 200,
    });

    console.log(`\n✅ [Webhook] Successfully processed message ${MessageSid}`);
    console.log(`   Restaurant: ${restaurantProfileId}`);
    console.log(`   Conversation: ${conversation.id}`);
    console.log(`   Message: ${message.id}`);
    console.log(`${'='.repeat(80)}\n`);

    return {
      success: true,
      restaurantId: restaurantProfileId,
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
