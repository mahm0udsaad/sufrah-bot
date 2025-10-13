import crypto from 'crypto';
import { jsonResponse } from '../http';
import { prisma } from '../../db/client';
import { TwilioClientManager } from '../../twilio/clientManager';
import { sendTextMessage, sendContentMessage } from '../../twilio/messaging';
import { getCachedContentSid } from '../../workflows/cache';
import { TWILIO_WHATSAPP_FROM } from '../../config';
import { eventBus } from '../../redis/eventBus';

const twilioClientManager = new TwilioClientManager();

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
    };

    const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber.trim() : '';
    const status = typeof body.status === 'string' ? body.status.trim() : '';
    const paymentStatus = typeof body.paymentStatus === 'string' ? body.paymentStatus.trim() : '';
    const externalMerchantId = typeof body.merchantId === 'string' ? body.merchantId.trim() : '';

    if (!orderNumber || !externalMerchantId) {
      return jsonResponse({ error: 'orderNumber and merchantId are required' }, 400);
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: { externalMerchantId },
    });
    if (!restaurant) {
      return jsonResponse({ error: 'Restaurant not found for merchantId' }, 404);
    }

    const order = await prisma.order.findFirst({
      where: {
        restaurantId: restaurant.id,
        orderReference: orderNumber,
      },
    });
    if (!order) {
      // Log but accept
      await prisma.webhookLog.create({
        data: {
          restaurantId: restaurant.id,
          requestId: crypto.randomUUID(),
          method: 'POST',
          path: '/status',
          headers: {},
          body: { orderNumber, status, paymentStatus, merchantId: externalMerchantId, note: 'Order not found' },
          statusCode: 202,
        },
      }).catch(() => {});
      return jsonResponse({ ok: true }, 202);
    }

    // Update order meta and optionally status
    const meta = (order.meta && typeof order.meta === 'object') ? { ...(order.meta as any) } : {};
    meta.paymentUpdate = {
      orderNumber,
      status,
      paymentStatus,
      merchantId: externalMerchantId,
      receivedAt: new Date().toISOString(),
    };

    // Map status/paymentStatus to OrderStatus when appropriate
    const nextData: any = { meta };
    if (paymentStatus.toLowerCase() === 'paid' || status.toLowerCase() === 'confirmed') {
      nextData.status = 'CONFIRMED';
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
      await eventBus.publishOrder(restaurant.id, {
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

    // Notify customer and send rating prompt
    const conversation = await prisma.conversation.findUnique({ where: { id: order.conversationId } });
    const customerPhone = conversation?.customerWa;
    const fromNumber = restaurant.whatsappNumber || TWILIO_WHATSAPP_FROM;

    if (customerPhone && fromNumber) {
      const twilioClient = await twilioClientManager.getClient(restaurant.id);
      if (twilioClient) {
        const confirmationText = paymentStatus.toLowerCase() === 'paid'
          ? `✅ تم تأكيد الدفع لطلبك رقم ${orderNumber}. شكرًا لك!`
          : `ℹ️ تحديث حالة طلبك رقم ${orderNumber}: ${status || paymentStatus}`;
        await sendTextMessage(twilioClient, fromNumber, customerPhone, confirmationText);

        try {
          const ratingSid = await getCachedContentSid('rating_list', async () => {
            throw new Error('rating template factory not configured');
          }, 'قيّم تجربتك معنا:');
          if (ratingSid) {
            await sendContentMessage(twilioClient, fromNumber, customerPhone, ratingSid, {
              logLabel: 'Rating list sent',
            });
          }
        } catch {
          await sendTextMessage(twilioClient, fromNumber, customerPhone, '⭐ كيف تقيم تجربتك؟ أرسل رقم من 1 إلى 5.');
        }
      }
    }

    // Log webhook
    await prisma.webhookLog.create({
      data: {
        restaurantId: restaurant.id,
        requestId: crypto.randomUUID(),
        method: 'POST',
        path: '/status',
        headers: {},
        body: { orderNumber, status, paymentStatus, merchantId: externalMerchantId },
        statusCode: 200,
      },
    }).catch(() => {});

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('❌ Error in /status webhook:', err);
    return jsonResponse({ error: 'Internal error' }, 500);
  }
}
