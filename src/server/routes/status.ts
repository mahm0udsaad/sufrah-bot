import crypto from 'crypto';
import { jsonResponse } from '../http';
import { prisma } from '../../db/client';
import { TwilioClientManager } from '../../twilio/clientManager';
import { sendTextMessage, sendContentMessage } from '../../twilio/messaging';
import { getCachedContentSid } from '../../workflows/cache';
import { TWILIO_WHATSAPP_FROM } from '../../config';
import { eventBus } from '../../redis/eventBus';

const twilioClientManager = new TwilioClientManager();

/**
 * Translates English order/payment status to Arabic
 */
function translateStatusToArabic(status: string): string {
  const normalized = status.trim().toLowerCase();
  
  // Payment status translations
  const paymentStatusMap: Record<string, string> = {
    'paid': 'تم الدفع',
    'Paid': 'تم الدفع',
    'pending': 'قيد الانتظار',
    'refunded': 'تم الاسترداد',
    'failed': 'فشل الدفع',
    'success': 'تم بنجاح',
    'succeeded': 'تم بنجاح',
    'completed': 'مكتمل',
    'confirmed': 'مؤكد',
    'captured': 'تم التحصيل',
    'authorized': 'مصرح به',
  };
  
  // Order status translations
  const orderStatusMap: Record<string, string> = {
    'inprogress': 'قيد التحضير',
    'in_progress': 'قيد التحضير',
    'in progress': 'قيد التحضير',
    'preparing': 'قيد التحضير',
    'received': 'تم الاستلام',
    'confirmed': 'مؤكد',
    'processing': 'قيد المعالجة',
    'ready': 'جاهز',
    'out_for_delivery': 'خرج للتوصيل',
    'out for delivery': 'خرج للتوصيل',
    'delivered': 'تم التوصيل',
    'completed': 'مكتمل',
    'cancelled': 'ملغى',
    'canceled': 'ملغى',
    'rejected': 'مرفوض',
  };
  
  // Check both maps
  return paymentStatusMap[normalized] || orderStatusMap[normalized] || status;
}

export async function handleStatus(req: Request, url: URL): Promise<Response | null> {
  if (!(req.method === 'POST' && url.pathname === '/status')) {
    return null;
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      orderNumber?: unknown;
      status?: unknown;
      paymentStatus?: unknown;
      merchantId?: unknown;
      branchId?: unknown;
    };

    // Handle orderNumber as either string or number
    const orderNumber = body.orderNumber 
      ? (typeof body.orderNumber === 'string' ? body.orderNumber.trim() : String(body.orderNumber))
      : '';
    const status = typeof body.status === 'string' ? body.status.trim() : '';
    const paymentStatus = typeof body.paymentStatus === 'string' ? body.paymentStatus.trim() : '';
    const externalMerchantId = typeof body.merchantId === 'string' ? body.merchantId.trim() : '';
    const branchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';

    // Log all incoming webhook data for debugging
    console.log('📥 [StatusWebhook] Received webhook:', {
      orderNumber,
      status,
      paymentStatus,
      merchantId: externalMerchantId,
      branchId,
      rawBody: body,
      timestamp: new Date().toISOString(),
    });

    if (!orderNumber || !externalMerchantId) {
      console.error('❌ [StatusWebhook] Missing required fields:', { orderNumber, merchantId: externalMerchantId });
      return jsonResponse({ error: 'orderNumber and merchantId are required' }, 400);
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: { externalMerchantId },
    });
    if (!restaurant) {
      console.error('❌ [StatusWebhook] Restaurant not found for merchantId:', externalMerchantId);
      return jsonResponse({ error: 'Restaurant not found for merchantId' }, 404);
    }

    console.log('✅ [StatusWebhook] Restaurant found:', {
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      externalMerchantId,
    });

    // First try to find order by orderReference alone (in case of duplicate merchants)
    const order = await prisma.order.findFirst({
      where: {
        orderReference: orderNumber,
      },
      include: {
        restaurant: true,
      },
    });
    
    if (!order) {
      console.warn('⚠️ [StatusWebhook] Order not found in database:', {
        orderNumber,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        note: 'This might be normal if the webhook arrives before order is saved',
      });
      // Log but accept
      await prisma.webhookLog.create({
        data: {
          restaurantId: restaurant.id,
          requestId: crypto.randomUUID(),
          method: 'POST',
          path: '/status',
          headers: {},
          body: { orderNumber, status, paymentStatus, merchantId: externalMerchantId, branchId, note: 'Order not found' },
          statusCode: 202,
        },
      }).catch(() => {});
      return jsonResponse({ ok: true }, 202);
    }

    // Verify the order's restaurant has matching externalMerchantId
    if (order.restaurant.externalMerchantId !== externalMerchantId) {
      console.error('❌ [StatusWebhook] MerchantId mismatch:', {
        orderNumber,
        orderRestaurantId: order.restaurantId,
        webhookMerchantId: externalMerchantId,
        orderMerchantId: order.restaurant.externalMerchantId,
      });
      return jsonResponse({ error: 'MerchantId mismatch' }, 400);
    }

    console.log('✅ [StatusWebhook] Order found:', {
      orderId: order.id,
      orderReference: order.orderReference,
      paymentMethod: order.paymentMethod,
      currentStatus: order.status,
      conversationId: order.conversationId,
    });

    // Update order meta and optionally status
    const meta = (order.meta && typeof order.meta === 'object') ? { ...(order.meta as any) } : {};
    
    // Payment status check - handle exact case "Paid" and lowercase variations
    // Expected values: "Paid", "Refunded", "Failed", "Pending"
    const normalizedPaymentStatus = paymentStatus ? paymentStatus.trim().toLowerCase() : '';
    const normalizedStatus = status ? status.trim().toLowerCase() : '';
    const paymentSuccessKeywords = ['paid', 'success', 'succeeded', 'completed', 'confirmed', 'captured', 'authorized'];
    
    const isPaymentApproved = 
      paymentStatus === 'Paid' || // Exact match for "Paid" with capital P
      paymentSuccessKeywords.some((keyword) =>
        normalizedPaymentStatus === keyword || normalizedStatus === keyword
      );
    
    const isOnlinePayment = (order.paymentMethod || '').toLowerCase() === 'online';
    const alreadyNotified = typeof meta.paymentConfirmationNotifiedAt === 'string' && meta.paymentConfirmationNotifiedAt.length > 0;
    const shouldSendPaymentContinuation = isPaymentApproved && isOnlinePayment && !alreadyNotified;
    const nowIso = new Date().toISOString();
    
    // Log payment decision logic
    console.log('💳 [StatusWebhook] Payment decision:', {
      orderNumber,
      paymentStatus,
      status,
      isPaymentApproved,
      isOnlinePayment,
      alreadyNotified,
      shouldSendPaymentContinuation,
      orderPaymentMethod: order.paymentMethod,
    });

    if (isPaymentApproved && isOnlinePayment && alreadyNotified) {
      console.log(`ℹ️ [StatusWebhook] Payment confirmation already processed for order ${order.id}, skipping follow-up.`);
    }

    meta.paymentUpdate = {
      orderNumber,
      status,
      paymentStatus,
      merchantId: externalMerchantId,
      branchId,
      receivedAt: nowIso,
    };

    if (shouldSendPaymentContinuation) {
      meta.awaitingPaymentConfirmation = false;
      meta.ratingPromptSent = true;
      meta.paymentConfirmationNotifiedAt = nowIso;
    }

    // Map status/paymentStatus to OrderStatus when appropriate
    const nextData: any = { meta };
    if (isPaymentApproved) {
      nextData.status = 'CONFIRMED';
    }
    if (shouldSendPaymentContinuation) {
      nextData.ratingAskedAt = new Date();
    }

    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: nextData,
      include: {
        items: true,
      },
    });

    // Publish order update event to Redis for real-time dashboard updates
    try {
      await eventBus.publishOrder(order.restaurantId, {
        type: 'order.updated',
        order: {
          id: updatedOrder.id,
          orderReference: updatedOrder.orderReference || orderNumber,
          status: updatedOrder.status,
          orderType: updatedOrder.orderType,
          paymentMethod: updatedOrder.paymentMethod,
          totalCents: updatedOrder.totalCents,
          currency: updatedOrder.currency,
          meta: updatedOrder.meta,
          updatedAt: updatedOrder.updatedAt,
          items: updatedOrder.items,
        },
      });
      console.log(`📡 [StatusWebhook] Published order.updated event for order ${updatedOrder.id}`);
    } catch (eventError) {
      console.error('⚠️ [StatusWebhook] Failed to publish order update event:', eventError);
    }

    // Notify customer and send rating prompt once payment is confirmed
    const conversation = await prisma.conversation.findUnique({ where: { id: order.conversationId } });
    const customerPhone = conversation?.customerWa;
    const fromNumber = order.restaurant.whatsappNumber || TWILIO_WHATSAPP_FROM;

    console.log('📱 [StatusWebhook] Customer notification check:', {
      orderNumber,
      hasCustomerPhone: !!customerPhone,
      hasFromNumber: !!fromNumber,
      conversationId: order.conversationId,
    });

    if (customerPhone && fromNumber) {
      const twilioClient = await twilioClientManager.getClient(order.restaurantId);
      if (twilioClient) {
        let statusMessage: string | null = null;

        if (shouldSendPaymentContinuation) {
          statusMessage = `✅ تم تأكيد الدفع لطلبك رقم ${orderNumber}. شكرًا لك!`;
          console.log('💬 [StatusWebhook] Sending payment confirmation message to customer:', customerPhone);
        } else if (status || paymentStatus) {
          const statusToTranslate = status || paymentStatus;
          const arabicStatus = translateStatusToArabic(statusToTranslate);
          statusMessage = `ℹ️ تحديث حالة طلبك رقم ${orderNumber}: ${arabicStatus}`;
          console.log('💬 [StatusWebhook] Sending status update message to customer:', customerPhone, `(${statusToTranslate} -> ${arabicStatus})`);
        }

        if (statusMessage) {
          await sendTextMessage(twilioClient, fromNumber, customerPhone, statusMessage);
          console.log('✅ [StatusWebhook] Status message sent successfully');
        }

        if (shouldSendPaymentContinuation) {
          console.log('⭐ [StatusWebhook] Sending rating prompt to customer');
          try {
            const ratingSid = await getCachedContentSid(
              'rating_list',
              async () => {
                throw new Error('rating template factory not configured');
              },
              'قيّم تجربتك معنا:'
            );
            if (ratingSid) {
              await sendContentMessage(twilioClient, fromNumber, customerPhone, ratingSid, {
                logLabel: 'Rating list sent',
              });
              console.log('✅ [StatusWebhook] Rating content template sent successfully');
            }
          } catch (err) {
            console.log('⚠️ [StatusWebhook] Rating template failed, sending fallback text:', err);
            await sendTextMessage(
              twilioClient,
              fromNumber,
              customerPhone,
              '⭐ كيف تقيم تجربتك؟ أرسل رقم من 1 إلى 5.'
            );
            console.log('✅ [StatusWebhook] Rating fallback text sent successfully');
          }
        }
      } else {
        console.warn('⚠️ [StatusWebhook] No Twilio client available for restaurant:', order.restaurantId);
      }
    } else {
      console.warn('⚠️ [StatusWebhook] Cannot send customer notification - missing phone or from number');
    }

    // Log webhook
    await prisma.webhookLog.create({
      data: {
        restaurantId: order.restaurantId,
        requestId: crypto.randomUUID(),
        method: 'POST',
        path: '/status',
        headers: {},
        body: { orderNumber, status, paymentStatus, merchantId: externalMerchantId, branchId },
        statusCode: 200,
      },
    }).catch(() => {});

    console.log('✅ [StatusWebhook] Webhook processed successfully:', {
      orderNumber,
      orderId: order.id,
      restaurantId: order.restaurantId,
      restaurantName: order.restaurant.name,
      paymentApproved: isPaymentApproved,
      confirmationSent: shouldSendPaymentContinuation,
    });

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('❌ Error in /status webhook:', err);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
}
