import type { TwilioClient, CartItem } from '../types';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { findOrCreateConversation } from '../db/conversationService';
import { fetchMerchantBranches } from './sufrahApi';
import {
  getConversationSession,
  updateConversationSession,
  type ConversationSession,
  type SessionOrderAddon,
  type SessionOrderItem,
} from '../state/session';
import { calculateCartTotal, getCart, getOrderState } from '../state/orders';
import { normalizePhoneNumber, standardizeWhatsappNumber, formatPhoneForSufrah } from '../utils/phone';
import { sendTextMessage, sendContentMessage } from '../twilio/messaging';
import { SUFRAH_API_BASE, SUFRAH_API_KEY, TWILIO_WHATSAPP_FROM, TWILIO_CONTENT_AUTH } from '../config';
import { logWebhookRequest } from '../db/webhookService';
import redis from '../redis/client';
import { getCachedContentSid } from '../workflows/cache';
import { createRatingListContent } from '../workflows/ratingTemplates';
import { notifyOrderCreated } from './notificationFeed';
import { notifyRestaurantOrder } from './whatsapp';
import { eventBus } from '../redis/eventBus';

export type OrderSubmissionErrorCode =
  | 'CONFIG_MISSING'
  | 'ORDER_NOT_FOUND'
  | 'MERCHANT_NOT_CONFIGURED'
  | 'NO_BRANCH_SELECTED'
  | 'INVALID_ITEMS'
  | 'MIN_ORDER_NOT_MET'
  | 'API_ERROR'
  | 'MISSING_PAYMENT_METHOD'
  | 'MISSING_ORDER_TYPE'
  | 'CUSTOMER_INFO_MISSING';

export class OrderSubmissionError extends Error {
  constructor(public readonly code: OrderSubmissionErrorCode, message: string) {
    super(message);
    this.name = 'OrderSubmissionError';
  }
}

export interface SubmitExternalOrderOptions {
  twilioClient: TwilioClient;
  customerPhone: string;
  fromNumber?: string;
}

interface PayloadAddon {
  productAddonId: string;
  quantity: number;
}

interface PayloadItem {
  productId: string;
  quantity: number;
  notes: string;
  addons: PayloadAddon[];
}

function buildSufrahUrl(path: string): string {
  const base = (SUFRAH_API_BASE || '').replace(/\/$/, '');
  const cleanedPath = path.replace(/^\//, '');
  console.log(`🚀 [OrderSubmission] SUFRAH_API_BASE: ${base}/${cleanedPath}`);
  return `${base}/${cleanedPath}`;
}
const BRANCH_CACHE_TTL_SECONDS = 600;
const MIN_ORDER_TOTAL_SAR = 20;

function isRedisReady(): boolean {
  return (redis as any)?.status === 'ready';
}

function roundToTwo(value: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number(value.toFixed(2));
  }
  const parsed = Number.parseFloat(String(value ?? 0));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function toExternalOrderType(type: string | undefined): string | undefined {
  if (!type) {
    return undefined;
  }
  const normalized = type.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  // Map internal values to backend enums
  if (normalized === 'pickup' || normalized === 'takeaway') {
    return 'Takeaway';
  }
  if (normalized === 'delivery') {
    return 'Delivery';
  }
  if (normalized === 'dinein' || normalized === 'dine_in' || normalized === 'dine-in') {
    return 'DineIn';
  }
  if (normalized === 'fromcar' || normalized === 'from_car' || normalized === 'drive' || normalized === 'drive_thru') {
    return 'FromCar';
  }
  // Fallback: capitalize first letter, but prefer explicit matches above
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function toExternalPaymentMethod(method: string | undefined): string | undefined {
  if (!method) {
    return undefined;
  }
  const normalized = method.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'online') {
    return 'Online';
  }
  if (normalized === 'cash') {
    return 'Cash';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function sanitizeAddon(addon: SessionOrderAddon): SessionOrderAddon {
  return {
    id: addon.id,
    name: addon.name,
    price: roundToTwo(addon.price),
    quantity: Math.max(1, Number.isFinite(addon.quantity) ? Math.round(addon.quantity) : 1),
    currency: addon.currency,
  };
}

function cartItemToSession(item: CartItem): SessionOrderItem {
  const addons = Array.isArray(item.addons)
    ? item.addons.map((addon) =>
        sanitizeAddon({
          id: addon.id,
          name: addon.name,
          price: addon.price,
          quantity: addon.quantity,
          currency: addon.currency ?? item.currency,
        })
      )
    : [];

  return {
    productId: item.id,
    name: item.name,
    quantity: Math.max(1, item.quantity ?? 1),
    unitPrice: roundToTwo(
      item.priceAfter !== null && item.priceAfter !== undefined ? item.priceAfter : item.price
    ),
    currency: item.currency,
    notes: item.notes,
    addons,
  } satisfies SessionOrderItem;
}

function sessionItemsFromCart(cart: CartItem[]): SessionOrderItem[] {
  return cart.map(cartItemToSession);
}

function toPayloadItem(item: SessionOrderItem): PayloadItem {
  if (!item.productId) {
    throw new OrderSubmissionError('INVALID_ITEMS', 'Missing product identifier for cart item.');
  }
  const addons: PayloadAddon[] = Array.isArray(item.addons)
    ? item.addons
        .filter((addon) => addon && typeof addon.id === 'string')
        .map((addon) => ({
          productAddonId: addon.id,
          quantity: Math.max(1, Number.isFinite(addon.quantity) ? Math.round(addon.quantity) : 1),
        }))
    : [];
  return {
    productId: item.productId,
    quantity: Math.max(1, Number.isFinite(item.quantity) ? Math.round(item.quantity) : 1),
    notes: item.notes ?? '',
    addons,
  } satisfies PayloadItem;
}

function buildBranchItemLines(items: SessionOrderItem[]): string[] {
  return items.flatMap((item) => {
    const base = `• ${item.name} x${item.quantity}`;
    const addonLines = (item.addons ?? []).map((addon) => `   - ${addon.name} x${addon.quantity}`);
    return [base, ...addonLines];
  });
}

async function getCachedBranchDetails(branchId: string): Promise<{ phoneNumber?: string; name?: string } | null> {
  if (!isRedisReady()) {
    return null;
  }
  try {
    const cached = await redis.get(`merchant:branch:${branchId}`);
    if (!cached) {
      return null;
    }
    const parsed = JSON.parse(cached);
    return {
      phoneNumber: typeof parsed.phoneNumber === 'string' ? parsed.phoneNumber : undefined,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
    };
  } catch (error) {
    console.warn('⚠️ [OrderSubmission] Failed to read branch cache:', error);
    return null;
  }
}

async function cacheBranchDetails(branchId: string, details: { phoneNumber?: string; name?: string }): Promise<void> {
  if (!isRedisReady()) {
    return;
  }
  try {
    await redis.setex(
      `merchant:branch:${branchId}`,
      BRANCH_CACHE_TTL_SECONDS,
      JSON.stringify(details)
    );
  } catch (error) {
    console.warn('⚠️ [OrderSubmission] Failed to cache branch details:', error);
  }
}

async function resolveBranchDetails(
  merchantId: string,
  branchId: string | undefined,
  session: ConversationSession | null
): Promise<{ phoneNumber?: string; name?: string }> {
  if (!branchId) {
    return {};
  }

  const normalizedBranchId = branchId.trim();
  if (!normalizedBranchId) {
    return {};
  }

  const sessionBranch = session?.selectedBranch;
  if (sessionBranch && sessionBranch.branchId === normalizedBranchId) {
    return {
      phoneNumber: sessionBranch.phoneNumber
        ? standardizeWhatsappNumber(sessionBranch.phoneNumber) || sessionBranch.phoneNumber
        : undefined,
      name:
        (sessionBranch.nameAr && sessionBranch.nameAr.trim()) ||
        (sessionBranch.nameEn && sessionBranch.nameEn.trim()) ||
        session?.branchName,
    };
  }

  const cached = await getCachedBranchDetails(normalizedBranchId);
  if (cached) {
    return cached;
  }

  try {
    const branches = await fetchMerchantBranches(merchantId);
    const matched = branches.find((branch) => branch.id === normalizedBranchId);
    if (matched) {
      const phoneNumber = matched.phoneNumber
        ? standardizeWhatsappNumber(matched.phoneNumber) || matched.phoneNumber
        : undefined;
      const name =
        (matched.nameAr && matched.nameAr.trim()) ||
        (matched.nameEn && matched.nameEn.trim()) ||
        session?.branchName ||
        matched.id;
      await cacheBranchDetails(normalizedBranchId, { phoneNumber, name });
      return { phoneNumber, name };
    }
  } catch (error) {
    console.error('❌ [OrderSubmission] Failed to fetch merchant branches for details:', error);
  }

  return {};
}

export async function submitExternalOrder(
  conversationId: string,
  { twilioClient, customerPhone, fromNumber }: SubmitExternalOrderOptions
): Promise<number> {
  if (!SUFRAH_API_KEY) {
    throw new OrderSubmissionError('CONFIG_MISSING', 'Sufrah API key is not configured');
  }

  const normalizedConversationId = normalizePhoneNumber(conversationId);

  console.log(`🧾 [OrderSubmission] Starting submission for conversation ${normalizedConversationId}`);

  const session = await getConversationSession(normalizedConversationId);
  const cart = getCart(normalizedConversationId);
  const state = getOrderState(normalizedConversationId);

  const restaurant = state.restaurant;
  if (!restaurant || !restaurant.id) {
    console.warn(`⚠️ [OrderSubmission] Missing restaurant context for ${normalizedConversationId}`);
    throw new OrderSubmissionError('MERCHANT_NOT_CONFIGURED', 'Restaurant context unavailable for order submission');
  }

  const merchantId = session?.merchantId || restaurant.externalMerchantId;
  if (!merchantId) {
    console.warn(`⚠️ [OrderSubmission] Restaurant ${restaurant.id} missing external merchant id.`);
    throw new OrderSubmissionError('MERCHANT_NOT_CONFIGURED', 'Restaurant missing external merchant ID');
  }

  const sessionItems = session?.items?.length ? session.items : sessionItemsFromCart(cart);
  if (!sessionItems.length) {
    throw new OrderSubmissionError('INVALID_ITEMS', 'Cart is empty. Add items before confirming the order.');
  }

  const orderType = session?.orderType || toExternalOrderType(state.type);
  if (!orderType) {
    throw new OrderSubmissionError('MISSING_ORDER_TYPE', 'Order type must be selected before confirming.');
  }

  let branchId = session?.branchId || session?.selectedBranch?.branchId || state.branchId;
  if ((orderType === 'Takeaway' || orderType === 'FromCar' || orderType === 'DineIn') && !branchId) {
    throw new OrderSubmissionError('NO_BRANCH_SELECTED', 'Branch selection is required for pickup orders.');
  }
  if (orderType === 'Delivery' && !branchId) {
    throw new OrderSubmissionError('NO_BRANCH_SELECTED', 'Branch resolution is required for delivery orders (please share location again).');
  }

  const paymentMethod = session?.paymentMethod || toExternalPaymentMethod(state.paymentMethod);
  if (!paymentMethod) {
    throw new OrderSubmissionError('MISSING_PAYMENT_METHOD', 'Select a payment method before confirming the order.');
  }

  const totals =
    session && session.total !== undefined
      ? { total: roundToTwo(Number(session.total)), currency: session.currency || 'SAR' }
      : (() => {
          const { total, currency } = calculateCartTotal(cart);
          return { total: roundToTwo(total), currency: currency || 'SAR' };
        })();

  if (orderType === 'Delivery' && totals.total < MIN_ORDER_TOTAL_SAR) {
    throw new OrderSubmissionError(
      'MIN_ORDER_NOT_MET',
      `Minimum order amount is ${MIN_ORDER_TOTAL_SAR} SAR.`
    );
  }

  const rawCustomerPhoneInput =
    session?.customerPhoneRaw || session?.customerPhone || customerPhone;

  const sanitizedCustomerPhone =
    standardizeWhatsappNumber(rawCustomerPhoneInput || customerPhone) || `+${normalizedConversationId}`;
  if (!sanitizedCustomerPhone) {
    throw new OrderSubmissionError('CUSTOMER_INFO_MISSING', 'Customer phone number is required to submit the order.');
  }

  const customerPhoneForSufrah = formatPhoneForSufrah(rawCustomerPhoneInput, sanitizedCustomerPhone);

  const customerName = session?.customerName || state.customerName || 'ضيف سُفرة';

  const commandPayload: any = {
    branchId: branchId ?? undefined,
    merchantId,
    orderType,
    paymentMethod,
    items: sessionItems.map(toPayloadItem),
    customerName,
    customerPhone: customerPhoneForSufrah,
  };

  // Add latitude and longitude for delivery orders
  if (orderType === 'Delivery') {
    const latitude = state.latitude;
    const longitude = state.longitude;
    
    if (latitude && longitude) {
      commandPayload.lat = latitude;
      commandPayload.lng = longitude;
      console.log(`📍 [OrderSubmission] Including delivery coordinates: lat=${latitude}, lng=${longitude}`);
    } else {
      console.warn(`⚠️ [OrderSubmission] Delivery order missing coordinates. lat=${latitude}, lng=${longitude}`);
    }
  }

  console.log(
    `🚀 [OrderSubmission] Submitting order for ${normalizedConversationId} to Sufrah with payload:`,
    JSON.stringify(commandPayload)
  );
  console.log(`🚀 [OrderSubmission] SUFRAH_API_KEY: ${SUFRAH_API_KEY}`);
  const response = await fetch(buildSufrahUrl('/orders/submit'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/plain',
      Authorization: `${SUFRAH_API_KEY}`,
    },
    body: JSON.stringify(commandPayload),
  });

  console.log(`📡 [OrderSubmission] Sufrah API response status: ${response.status}`);
  console.log(`📡 [OrderSubmission] Sufrah API response headers:`, Object.fromEntries(response.headers.entries()));

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `❌ [OrderSubmission] Sufrah submission failed for conversation ${normalizedConversationId} with status ${response.status}: ${errorBody}`
    );
    try {
      await logWebhookRequest({
        restaurantId: restaurant.id,
        requestId: `order_submit:${normalizedConversationId}:${Date.now()}`,
        method: 'POST',
        path: '/orders/submit',
        body: commandPayload,
        statusCode: response.status,
        errorMessage: errorBody,
      });
    } catch (logError) {
      console.error('⚠️ Failed to record order submission error log:', logError);
    }

    throw new OrderSubmissionError('API_ERROR', `Failed to submit order: ${response.status} ${errorBody}`);
  }

  let orderNumber: number | undefined;
  let confirmedBranchId: string | undefined;
  let paymentLink: string | undefined;
  let fullResponseData: any = null;
  
  try {
    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();
    
    console.log(`📡 [OrderSubmission] Raw response body:`, rawText);
    
    if (contentType.includes('application/json') || rawText.trim().startsWith('{')) {
      try {
        const parsed: any = JSON.parse(rawText);
        fullResponseData = parsed;
        
        console.log(`✅ [OrderSubmission] Parsed JSON response:`, JSON.stringify(parsed, null, 2));
        
        orderNumber = typeof parsed?.orderNumber === 'number' ? parsed.orderNumber : undefined;
        confirmedBranchId = typeof parsed?.branchId === 'string' ? parsed.branchId : undefined;
        paymentLink = typeof parsed?.paymentLink === 'string' ? parsed.paymentLink : 
                     typeof parsed?.paymentUrl === 'string' ? parsed.paymentUrl : undefined;
        
        if (paymentMethod === 'Online') {
          console.log(`💳 [OrderSubmission] Online payment detected. Payment link: ${paymentLink || 'NOT PROVIDED'}`);
          if (parsed) {
            console.log(`💳 [OrderSubmission] Full response for Online payment:`, JSON.stringify(parsed, null, 2));
          }
        }
      } catch (parseError) {
        console.warn(`⚠️ [OrderSubmission] Failed to parse JSON response:`, parseError);
        const matched = rawText.match(/\d+/);
        if (matched) {
          orderNumber = Number.parseInt(matched[0]!, 10);
        }
      }
    } else {
      console.log(`📡 [OrderSubmission] Non-JSON response (text/plain):`, rawText);
      const matched = rawText.match(/\d+/);
      if (matched) {
        orderNumber = Number.parseInt(matched[0]!, 10);
      }
    }
  } catch (error) {
    console.error('⚠️ [OrderSubmission] Failed to parse Sufrah order submission response:', error);
  }

  if (!orderNumber || Number.isNaN(orderNumber)) {
    console.error(`❌ [OrderSubmission] Missing order number in Sufrah response for ${normalizedConversationId}`);
    throw new OrderSubmissionError('API_ERROR', 'Sufrah response missing order number');
  }

  if (confirmedBranchId) {
    branchId = confirmedBranchId;
  }

  const isOnlinePayment = (paymentMethod || '').toLowerCase() === 'online';
  const shouldAwaitPaymentConfirmation = isOnlinePayment && !!paymentLink;
  const nowIsoString = new Date().toISOString();

  const metaPayload = {
    orderNumber,
    total: totals.total,
    currency: totals.currency,
    paymentMethod,
    orderType,
    branchId,
    items: sessionItems,
    customerName,
    customerPhone: sanitizedCustomerPhone,
    paymentLink: paymentLink || null,
    sufrahResponse: fullResponseData || null,
    awaitingPaymentConfirmation: shouldAwaitPaymentConfirmation,
    ratingPromptSent: !shouldAwaitPaymentConfirmation,
    paymentLinkSentAt: shouldAwaitPaymentConfirmation ? nowIsoString : undefined,
  } as Record<string, unknown>;

  const metaValue = JSON.parse(
    JSON.stringify(metaPayload)
  );

  const branchDetails = await resolveBranchDetails(merchantId, branchId, session);
  const branchPhone = branchDetails.phoneNumber;
  const branchName = branchDetails.name || session?.branchName || state.branchName || undefined;

  // Ensure conversation exists before creating order
  const conversation = await findOrCreateConversation(
    restaurant.id,
    normalizedConversationId,
    customerName || undefined
  );

  let createdOrderId: string | undefined;

  console.log(`💾 [OrderSubmission] Creating order record for Sufrah order #${orderNumber}`, {
    restaurantId: restaurant.id,
    conversationId: conversation.id,
    orderNumber,
  });

  try {
    const createdOrder = await prisma.order.create({
      data: {
        restaurantId: restaurant.id,
        conversationId: conversation.id,
        orderReference: orderNumber.toString(), // Set immediately with Sufrah order number
        orderType,
        paymentMethod,
        totalCents: Math.round(totals.total * 100),
        currency: totals.currency,
        deliveryAddress: state.locationAddress,
        deliveryLat: state.latitude,
        deliveryLng: state.longitude,
        branchId: branchId ?? null,
        branchName: branchName ?? null,
        branchAddress: state.branchAddress ?? null,
        meta: metaValue as unknown as Prisma.InputJsonValue,
        status: 'CONFIRMED', // Mark as confirmed since it's submitted to Sufrah
      },
    });

    createdOrderId = createdOrder.id;
    console.log(`✅ [OrderSubmission] Order record created successfully:`, {
      orderId: createdOrder.id,
      orderReference: createdOrder.orderReference,
      restaurantId: createdOrder.restaurantId,
      sufrahOrderNumber: orderNumber,
    });

    try {
      await notifyOrderCreated({
        restaurantId: restaurant.id,
        orderId: createdOrder.id,
        orderReference: createdOrder.orderReference,
        totalCents: createdOrder.totalCents,
        currency: createdOrder.currency,
        conversationId: conversation.id,
        customerName,
        customerPhone: normalizePhoneNumber(sanitizedCustomerPhone),
      });
    } catch (error) {
      console.error('❌ [Notifications] Failed to record order-created notification:', error);
    }

    // Create OrderItem records for each item in the order
    let orderItems: any[] = [];
    if (sessionItems.length > 0) {
      orderItems = sessionItems.map((item) => {
        const itemTotal = roundToTwo(item.unitPrice * item.quantity);
        const addonsTotal = (item.addons || []).reduce((sum, addon) => {
          return sum + roundToTwo(addon.price * addon.quantity);
        }, 0);
        const grandItemTotal = roundToTwo(itemTotal + addonsTotal);

        return {
          id: `${createdOrder.id}-${item.productId}`,
          orderId: createdOrder.id,
          name: item.name,
          qty: item.quantity,
          unitCents: Math.round(item.unitPrice * 100),
          totalCents: Math.round(grandItemTotal * 100),
        };
      });

      await prisma.orderItem.createMany({
        data: orderItems,
        skipDuplicates: true,
      });

      console.log(`📦 [OrderSubmission] Created ${orderItems.length} order items for order ${createdOrder.id}`);
    }

    // Publish order event to Redis for real-time dashboard updates
    try {
      await eventBus.publishOrder(restaurant.id, {
        type: 'order.created',
        order: {
          id: createdOrder.id,
          orderReference: orderNumber.toString(),
          status: createdOrder.status,
          orderType: createdOrder.orderType,
          paymentMethod: createdOrder.paymentMethod,
          totalCents: createdOrder.totalCents,
          currency: createdOrder.currency,
          createdAt: createdOrder.createdAt,
          items: orderItems,
        },
      });
      console.log(`📡 [OrderSubmission] Published order.created event for order ${createdOrder.id}`);
    } catch (eventError) {
      console.error('⚠️ [OrderSubmission] Failed to publish order event:', eventError);
    }
  } catch (error) {
    console.error('⚠️ [OrderSubmission] Failed to persist order locally:', error);
  }

  try {
    await updateConversationSession(normalizedConversationId, {
      lastOrderNumber: orderNumber,
    });
  } catch (error) {
    console.warn('⚠️ [OrderSubmission] Failed to update conversation session with order number:', error);
  }

  const senderNumber = fromNumber || restaurant.whatsappNumber || TWILIO_WHATSAPP_FROM;
  const paymentLabel = paymentMethod === 'Cash' ? 'الدفع نقداً' : paymentMethod === 'Online' ? 'دفع إلكتروني' : paymentMethod;

  const customerMessageLines = [
    `✅ تم تسجيل طلبك رقم #${orderNumber} بنجاح!`,
    `💳 طريقة الدفع: ${paymentLabel}`,
    `💰 الإجمالي: ${totals.total.toFixed(2)} ${totals.currency}`,
    branchName ? `🏪 الفرع: ${branchName}` : undefined,
  ];

  if (isOnlinePayment && paymentLink) {
    customerMessageLines.push('');
    customerMessageLines.push('🔗 لإتمام الدفع، يرجى استخدام الرابط التالي:');
    customerMessageLines.push(paymentLink);
    customerMessageLines.push('');
    customerMessageLines.push('⏰ يرجى إتمام الدفع لتأكيد طلبك. سنقوم بتأكيد الدفع فور استلامه.');
  } else if (isOnlinePayment) {
    customerMessageLines.push('⏰ تمت جدولة طلبك للدفع الإلكتروني، وسنؤكد إكماله حال تحديث حالة الدفع.');
  } else {
    customerMessageLines.push('سنبدأ بتحضير طلبك الآن.');
  }

  const customerMessage = customerMessageLines.filter(Boolean).join('\n');

  await sendTextMessage(twilioClient, senderNumber, sanitizedCustomerPhone, customerMessage);

  if (!shouldAwaitPaymentConfirmation) {
    try {
      const ratingContentSid = await getCachedContentSid(
        'rating_list',
        () => createRatingListContent(TWILIO_CONTENT_AUTH),
        'اختر تقييمك من 1 إلى 5 ⭐'
      );
      await sendContentMessage(
        twilioClient,
        senderNumber,
        sanitizedCustomerPhone,
        ratingContentSid,
        { logLabel: 'Rating list template sent' }
      );
      console.log(`⭐ [OrderSubmission] Rating template sent to ${sanitizedCustomerPhone}`);
      
      // Mark that we've sent the rating prompt
      if (createdOrderId) {
        try {
          await prisma.order.update({
            where: { id: createdOrderId },
            data: { ratingAskedAt: new Date() },
          });
          console.log(`✅ [OrderSubmission] Marked ratingAskedAt for order #${orderNumber}`);
        } catch (markError) {
          console.error('⚠️ [OrderSubmission] Failed to mark ratingAskedAt:', markError);
        }
      }
    } catch (error) {
      console.error('⚠️ [OrderSubmission] Failed to send rating template:', error);
    }
  } else {
    console.log('⏳ [OrderSubmission] Deferring rating prompt until payment confirmation webhook arrives.');
  }

  if (branchPhone) {
    try {
      // Format the current timestamp in Arabic
      const now = new Date();
      const dateOptions: Intl.DateTimeFormatOptions = { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      };
      const timeOptions: Intl.DateTimeFormatOptions = { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      };
      const formattedDate = now.toLocaleDateString('ar-SA', dateOptions);
      const formattedTime = now.toLocaleTimeString('ar-SA', timeOptions);

      // Build item lines with addons
      const itemLines = sessionItems.map((item) => {
        let line = `- ${item.name} × ${item.quantity}`;
        if (item.addons && item.addons.length > 0) {
          const addonTexts = item.addons.map((addon) => `${addon.name} × ${addon.quantity}`);
          line += ` (${addonTexts.join(', ')})`;
        }
        return line;
      });

      // Use the total directly
      const orderTotal = totals.total;

      // Extract notes from items
      const notesArray = sessionItems
        .map((item) => item.notes)
        .filter((note): note is string => Boolean(note?.trim()));
      const notesText = notesArray.length > 0 ? notesArray.join('، ') : 'لا توجد ملاحظات';

      // Build delivery info section if applicable
      let deliveryInfoSection = '';
      if (orderType === 'Delivery' && state.locationAddress) {
        const addressLines = [
          state.locationAddress,
        ];
        
        if (state.latitude && state.longitude) {
          const mapLink = `https://www.google.com/maps?q=${state.latitude},${state.longitude}`;
          addressLines.push(`رابط الموقع: ${mapLink}`);
        }

        deliveryInfoSection = [
          '',
          '*معلومات التوصيل:*',
          ...addressLines,
        ].join('\n');
      }

      const branchMessage = [
        '*طلب جديد من منصة سفرة*',
        '',
        `العميل: ${customerName}`,
        `رقم الجوال: ${sanitizedCustomerPhone}`,
        `طريقة الدفع: ${paymentLabel}`,
        branchName ? `الفرع: ${branchName}` : '',
        '',
        '*تفاصيل الطلب:*',
        ...itemLines,
        '',
        `الإجمالي: ${orderTotal.toFixed(2)} ${totals.currency}`,
        `ملاحظات: ${notesText}`,
        `وقت الطلب: ${formattedDate} - ${formattedTime}`,
        deliveryInfoSection,
        '',
        '---',
        '',
        '*فضلاً تجهيز الطلب والتواصل مع العميل في حال وجود أي استفسار.*',
      ]
        .filter(Boolean)
        .join('\n');

      await notifyRestaurantOrder(twilioClient, restaurant.id, branchMessage, {
        toNumber: branchPhone,
        fromNumber: senderNumber,
      });
    } catch (error) {
      console.error('⚠️ [OrderSubmission] Failed to notify branch about new order:', error);
    }
  } else {
    console.warn('⚠️ [OrderSubmission] Branch phone number unavailable. Skipping branch notification.');
  }

  console.log(
    `🎉 [OrderSubmission] Submission completed for conversation ${normalizedConversationId} -> order #${orderNumber}`
  );

  return orderNumber;
}
