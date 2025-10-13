import crypto from 'crypto';
import { jsonResponse } from '../http';
import { VERIFY_TOKEN, TWILIO_WHATSAPP_FROM } from '../../config';
import { processInboundWebhook } from '../../webhooks/inboundHandler';
import { processMessage, resolveRestaurantContext } from '../../handlers/processMessage';
import { normalizePhoneNumber } from '../../utils/phone';
import { findOrCreateConversation as findOrCreateDbConversation, updateConversation as updateDbConversation } from '../../db/conversationService';
import { createInboundMessage } from '../../db/messageService';
import { consumeCachedMessageForPhone, sendNotification } from '../../services/whatsapp';
import { TwilioClientManager } from '../../twilio/clientManager';

const twilioClientManager = new TwilioClientManager();

export async function handleTwilioForm(req: Request, url: URL): Promise<Response | null> {
  const isTwilioWebhookPath =
    url.pathname === '/whatsapp/webhook' || url.pathname === '/webhook';

  if (!(req.method === 'POST' && isTwilioWebhookPath)) {
    return null;
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('application/x-www-form-urlencoded')) {
      // Allow JSON requests on /webhook to fall through to the Meta handler
      if (url.pathname === '/webhook') {
        return null;
      }
      return new Response('Unsupported Media Type', { status: 415 });
    }

    const raw = await req.text();
    const params = new URLSearchParams(raw);
    const payload = Object.fromEntries(params.entries());

    const host = req.headers.get('host') ?? '';
    const proto = req.headers.get('x-forwarded-proto') || 'http';
    const fullUrl = `${proto}://${host}${url.pathname}`;
    const signature = req.headers.get('x-twilio-signature');
    const requestId = crypto.randomUUID();

    const result = await processInboundWebhook(
      payload as any,
      fullUrl,
      signature,
      requestId
    );

    return new Response(null, { status: result.statusCode });
  } catch (error) {
    console.error(`❌ Error in ${url.pathname}:`, error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

export async function handleVerify(req: Request, url: URL): Promise<Response | null> {
  if (!(req.method === 'GET' && url.pathname === '/webhook')) {
    return null;
  }

  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  console.log('🔍 Webhook verification attempt:', { mode, token, challenge });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully');
    return new Response(challenge);
  } else {
    console.log('❌ Webhook verification failed');
    return new Response('Forbidden', { status: 403 });
  }
}

export async function handleMeta(req: Request, url: URL): Promise<Response | null> {
  if (!(req.method === 'POST' && url.pathname === '/webhook')) {
    return null;
  }

  try {
    const contentType = req.headers.get('content-type') || '';

    // Only handle Meta JSON here; Twilio form should go to /whatsapp/webhook
    if (contentType.includes('application/x-www-form-urlencoded')) {
      return null;
    }

    const body: any = await req.json();
    console.log('📨 Meta webhook received:', JSON.stringify(body, null, 2));

    if (body.object === 'whatsapp_business_account') {
      await Promise.all(
        (body.entry || []).map(async (entry: any) => {
          await Promise.all(
            (entry.changes || []).map(async (change: any) => {
              if (change.field !== 'messages') return;
              const value = change.value;
              if (!value.messages) return;

              await Promise.all(
                value.messages.map(async (message: any) => {
                  const phoneNumber = message.from;
                  let messageBody = '';
                  let messageType = message.type;
                  const extraPayload: any = {};
                  const contactProfileName =
                    value.contacts?.[0]?.profile?.name ||
                    message.profile?.name;
                  if (contactProfileName) {
                    extraPayload.profileName = contactProfileName;
                  }

                  const recipientPhone =
                    message.to ||
                    value.metadata?.display_phone_number ||
                    value.metadata?.phone_number_id ||
                    value.metadata?.phone?.number;
                  if (recipientPhone) {
                    extraPayload.recipientPhone = recipientPhone;
                  }

                  switch (messageType) {
                    case 'text':
                      messageBody = message.text?.body || '';
                      console.log(`🔍 DEBUG: Text message received: "${messageBody}"`);
                      break;
                    case 'interactive':
                      if (message.interactive?.type === 'button_reply') {
                        messageBody = message.interactive.button_reply?.id || '';
                        const buttonText = message.interactive.button_reply?.title || '';
                        console.log(`🔍 DEBUG: Button reply received: "${messageBody}" (${buttonText})`);

                        const isViewOrderRequest =
                          messageBody === 'view_order' ||
                          buttonText === 'View Order Details';

                        if (isViewOrderRequest) {
                          console.log(`🔘 [Meta ButtonClick] User requested "View Order Details" from ${phoneNumber}`);
                          try {
                            const restaurantContext = await resolveRestaurantContext(phoneNumber, recipientPhone);
                            if (restaurantContext) {
                              const normalizedCustomer = normalizePhoneNumber(phoneNumber);
                              const normalizedRecipient = normalizePhoneNumber(recipientPhone || TWILIO_WHATSAPP_FROM);
                              const dbConversation = await findOrCreateDbConversation(
                                restaurantContext.id,
                                normalizedCustomer,
                                contactProfileName
                              );

                              await createInboundMessage({
                                conversationId: dbConversation.id,
                                restaurantId: restaurantContext.id,
                                waSid: `button_${Date.now()}_${phoneNumber}`,
                                fromPhone: normalizedCustomer,
                                toPhone: normalizedRecipient,
                                messageType: 'button',
                                content: buttonText || 'View Order Details',
                                metadata: { buttonPayload: messageBody, buttonText, isButtonResponse: true },
                              });

                              await updateDbConversation(dbConversation.id, {
                                lastMessageAt: new Date(),
                              });

                              const cachedMessage = await consumeCachedMessageForPhone(phoneNumber);
                              if (cachedMessage) {
                                const twilioClient = await twilioClientManager.getClient(restaurantContext.id);
                                if (twilioClient) {
                                  await sendNotification(twilioClient, phoneNumber, cachedMessage, { fromNumber: recipientPhone || TWILIO_WHATSAPP_FROM, forceFreeform: true });
                                }
                              } else {
                                const twilioClient = await twilioClientManager.getClient(restaurantContext.id);
                                if (twilioClient) {
                                  await sendNotification(twilioClient, phoneNumber, 'Sorry, order details are no longer available. Please contact support.', { fromNumber: recipientPhone || TWILIO_WHATSAPP_FROM, forceFreeform: true });
                                }
                              }
                            }
                          } catch (persistErr) {
                            console.warn('⚠️ [Meta ButtonClick] Failed to persist button click to database (continuing):', persistErr);
                          }
                          return;
                        }
                      } else if (message.interactive?.type === 'list_reply') {
                        messageBody = message.interactive.list_reply?.id || '';
                        console.log(`🔍 DEBUG: List reply received: "${messageBody}"`);
                      }
                      break;
                    case 'location':
                      if (message.location) {
                        extraPayload.location = {
                          latitude: message.location.latitude?.toString(),
                          longitude: message.location.longitude?.toString(),
                          address: message.location.address,
                        };
                        messageBody = message.location.address
                          ? message.location.address
                          : `📍 موقع: ${message.location.latitude}, ${message.location.longitude}`;
                      }
                      break;
                    default:
                      console.log('❓ Unsupported message type:', messageType);
                      return;
                  }

                  if (phoneNumber && messageBody) {
                    console.log(`📱 Processing Meta message: ${phoneNumber} -> ${messageBody}`);
                    await processMessage(phoneNumber, messageBody, messageType, extraPayload);
                  }
                })
              );
            })
          );
        })
      );
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

