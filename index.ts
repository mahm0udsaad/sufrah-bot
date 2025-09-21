import twilio from 'twilio';
import type { CartItem } from './src/types';
import {
  addItemToCart,
  calculateCartTotal,
  getCart,
  getOrderState,
  removeItemFromCart,
  resetOrder,
  setPendingItem,
  updateOrderState,
  formatCartMessage,
  getActiveCartsCount,
  generateOrderReference,
} from './src/state/orders';

import {
  getOrCreateConversation,
  getConversations,
  getConversationMessages,
  setConversationData,
  getConversationById,
  onMessageAppended,
  onConversationUpdated,
  markConversationRead,
} from './src/state/conversations';

import { sendContentMessage, sendTextMessage } from './src/twilio/messaging';
import { createContent } from './src/twilio/content';
import { normalizePhoneNumber } from './src/utils/phone';
import { buildCategoriesFallback, matchesAnyTrigger } from './src/utils/text';
import { getReadableAddress } from './src/utils/geocode';
import type { MessageType } from './src/types';
import {
  PORT,
  VERIFY_TOKEN,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  NOMINATIM_USER_AGENT,
  PAYMENT_LINK,
  SUPPORT_CONTACT,
  TWILIO_CONTENT_AUTH,
} from './src/config';
import {
  MAX_ITEM_QUANTITY,
  FOOD_CATEGORIES,
  CATEGORY_ITEMS,
  PICKUP_BRANCHES,
  findCategoryById,
  findItemById,
  findBranchById,
  findBranchByText,
} from './src/workflows/menuData';
import {
  createOrderTypeQuickReply,
  createFoodListPicker,
  createItemsListPicker,
  createPostItemChoiceQuickReply,
  createLocationRequestQuickReply,
  createQuantityQuickReply,
  createCartOptionsQuickReply,
  createRemoveItemListQuickReply,
  createPaymentOptionsQuickReply,
  createBranchListPicker,
} from './src/workflows/quickReplies';
import { getCachedContentSid, seedCacheFromKey } from './src/workflows/cache';
import { mapConversationToApi, mapMessageToApi } from './src/workflows/mappers';
import { broadcast, notifyBotStatus, registerWebsocketClient, removeWebsocketClient } from './src/workflows/events';
import { recordInboundMessage } from './src/workflows/messages';
import { registerTemplateTextForSid } from './src/workflows/templateText';

// Initialize Twilio client
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
let globalBotEnabled = true;
let welcomeContentSid = process.env.CONTENT_SID_WELCOME || '';
let welcomeApprovalRequested = !!welcomeContentSid;

seedCacheFromKey('welcome', welcomeContentSid);
seedCacheFromKey('order_type', process.env.CONTENT_SID_ORDER_TYPE || '');
seedCacheFromKey('categories', process.env.CONTENT_SID_CATEGORIES || '');
seedCacheFromKey('post_item_choice', process.env.CONTENT_SID_POST_ITEM_CHOICE || '');
seedCacheFromKey('location_request', process.env.CONTENT_SID_LOCATION_REQUEST || '');
seedCacheFromKey('quantity_prompt', process.env.CONTENT_SID_QUANTITY || '');
seedCacheFromKey('cart_options', process.env.CONTENT_SID_CART_OPTIONS || '');
seedCacheFromKey('payment_options', process.env.CONTENT_SID_PAYMENT_OPTIONS || '');
seedCacheFromKey('branch_list', process.env.CONTENT_SID_BRANCH_LIST || '');

const baseHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,ngrok-skip-browser-warning',
};

onMessageAppended((message) =>
  broadcast({ type: 'message.created', data: mapMessageToApi(message) })
);

onConversationUpdated((conversation) =>
  broadcast({ type: 'conversation.updated', data: mapConversationToApi(conversation) })
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: baseHeaders,
  });
}

const ORDER_STATUS_SEQUENCE = [
  '🧾 تم استلام الطلب وجارٍ مراجعته.',
  '👨‍🍳 يتم تجهيز طلبك الآن.',
  '🛵 انطلق سائق التوصيل بالطلب.',
  '✅ تم تسليم الطلب. نتمنى لك وجبة شهية!'
];

const orderStatusTimers = new Map<string, ReturnType<typeof setTimeout>>();

function stopOrderStatusSimulation(phoneNumber: string) {
  const timer = orderStatusTimers.get(phoneNumber);
  if (timer) {
    clearTimeout(timer);
    orderStatusTimers.delete(phoneNumber);
  }
}

function scheduleNextOrderStatus(phoneNumber: string) {
  const state = getOrderState(phoneNumber);
  const nextStage = state.statusStage ?? 0;
  if (nextStage >= ORDER_STATUS_SEQUENCE.length) {
    stopOrderStatusSimulation(phoneNumber);
    return;
  }

  const timer = setTimeout(() => {
    orderStatusTimers.delete(phoneNumber);
    advanceOrderStatus(phoneNumber).catch((error) => {
      console.error('❌ Error advancing order status:', error);
    });
  }, 60_000);

  orderStatusTimers.set(phoneNumber, timer);
}

async function advanceOrderStatus(phoneNumber: string): Promise<void> {
  const state = getOrderState(phoneNumber);
  const nextStage = state.statusStage ?? 0;
  if (nextStage >= ORDER_STATUS_SEQUENCE.length) {
    stopOrderStatusSimulation(phoneNumber);
    return;
  }

  const statusMessage = ORDER_STATUS_SEQUENCE[nextStage];
  const orderRef = state.orderReference ? `\nرقم الطلب: ${state.orderReference}` : '';
  await sendTextMessage(
    client,
    TWILIO_WHATSAPP_FROM,
    phoneNumber,
    `${statusMessage}${orderRef}`
  );

  updateOrderState(phoneNumber, {
    statusStage: nextStage + 1,
    lastStatusMessage: statusMessage,
  });

  scheduleNextOrderStatus(phoneNumber);
}

async function startOrderStatusSimulation(phoneNumber: string): Promise<void> {
  const state = getOrderState(phoneNumber);
  if ((state.statusStage ?? 0) >= ORDER_STATUS_SEQUENCE.length) {
    return;
  }

  if (orderStatusTimers.has(phoneNumber)) {
    return;
  }

  await advanceOrderStatus(phoneNumber);
}

// Track users who have received welcome message
const welcomedUsers = new Set<string>();

// Send welcome template
// Send welcome template
export async function sendWelcomeTemplate(to: string, profileName?: string) {
  try {
    if (!welcomeContentSid) {
      const created = await client.content.v1.contents.create({
        friendly_name: `welcome_qr_${Date.now()}`,
        language: "ar",
        variables: {
          "1": process.env.RESTAURANT_NAME || "مطعم XYZ",
          "2": profileName || 'ضيفنا الكريم',
        },
        types: {
          "twilio/quick-reply": {
            body: `مرحباً {{2}} في {{1}}!\nكيف يمكننا خدمتك اليوم؟`,
            actions: [
              { title: "🆕 طلب جديد", id: "new_order", type: "QUICK_REPLY" },
              { title: "🚚 تتبع الطلب", id: "track_order", type: "QUICK_REPLY" },
              { title: "☎️ تواصل مع الدعم", id: "contact_support", type: "QUICK_REPLY" }
            ]
          },
          "twilio/text": {
            body: "مرحباً {{2}} في {{1}}!"
          }
        }
      });

      welcomeContentSid = created.sid;
      welcomeApprovalRequested = false;
      seedCacheFromKey('welcome', welcomeContentSid);
      console.log('📦 Created welcome content:', welcomeContentSid);
    }

    if (!welcomeApprovalRequested && welcomeContentSid) {
      const approvalRes = await fetch(
        `https://content.twilio.com/v1/Content/${welcomeContentSid}/ApprovalRequests/whatsapp`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${TWILIO_CONTENT_AUTH}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!approvalRes.ok) {
        const errText = await approvalRes.text();
        console.error('❌ Approval request failed:', errText);
      } else {
        const approvalJson = await approvalRes.json();
        console.log('📨 Approval requested:', approvalJson);
      }

      welcomeApprovalRequested = true;
    }

    if (!welcomeContentSid) {
      throw new Error('Welcome content SID unavailable');
    }

    return sendContentMessage(client, TWILIO_WHATSAPP_FROM, to, welcomeContentSid, {
      variables: {
        1: process.env.RESTAURANT_NAME || "مطعم XYZ",
        2: profileName || 'ضيفنا الكريم',
      },
      logLabel: 'Welcome template sent'
    });
  } catch (error) {
    console.error("❌ Error in sendWelcomeTemplate:", error);

    // fallback: plain text
    const fallback = `🌟 أهلاً بك يا ${profileName || 'ضيفنا الكريم'} في ${process.env.RESTAURANT_NAME || "مطعم XYZ"}! 🌟

🍽️ لبدء طلب جديد اكتب "طلب جديد" أو اضغط على زر 🆕.`;
    return sendTextMessage(client, TWILIO_WHATSAPP_FROM, to, fallback);
  }
}




async function sendItemMediaMessage(
  phoneNumber: string,
  body: string,
  imageUrl: string
): Promise<void> {
  if (!imageUrl) {
    await sendTextMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, body);
    return;
  }
  const payload = {
    friendly_name: `item_media_${Date.now()}`,
    language: "ar",
    types: {
      "twilio/media": {
        body,
        media: [imageUrl]
      }
    }
  } as any;

  const contentSid = await createContent(TWILIO_CONTENT_AUTH, payload, 'Item media content created');
  await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, contentSid, {
    logLabel: 'Item media message sent'
  });
}

async function finalizeItemQuantity(
  phoneNumber: string,
  pendingItem: Omit<CartItem, 'quantity'>,
  quantity: number
): Promise<void> {
  console.log(`🔍 DEBUG: finalizeItemQuantity called for ${phoneNumber}, item: ${pendingItem.name}, quantity: ${quantity}`);
  
  addItemToCart(phoneNumber, pendingItem, quantity);
  console.log(`✅ DEBUG: Item added to cart for ${phoneNumber}`);
  
  setPendingItem(phoneNumber, undefined);
  updateOrderState(phoneNumber, { pendingQuantity: undefined });
  console.log(`✅ DEBUG: Pending item cleared for ${phoneNumber}`);

  const currency = pendingItem.currency || 'ر.س';
  const lineTotal = Number((pendingItem.price * quantity).toFixed(2));
  const additionText = `✅ تم إضافة ${quantity} × ${pendingItem.name} إلى السلة (الإجمالي ${lineTotal} ${currency})`;
  
  console.log(`🔍 DEBUG: Sending confirmation message to ${phoneNumber}: "${additionText}"`);
  
  if (pendingItem.image) {
    console.log(`🔍 DEBUG: Sending media message with image for ${phoneNumber}`);
    await sendItemMediaMessage(phoneNumber, additionText, pendingItem.image);
  } else {
    console.log(`🔍 DEBUG: Sending text message for ${phoneNumber}`);
    await sendTextMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, additionText);
  }
  
  console.log(`✅ DEBUG: Confirmation message sent to ${phoneNumber}`);

  try {
    console.log(`🔍 DEBUG: Creating post-item choice quick reply for ${phoneNumber}`);
    const quickSid = await getCachedContentSid(
      'post_item_choice',
      () => createPostItemChoiceQuickReply(TWILIO_CONTENT_AUTH),
      'هل ترغب في إضافة صنف آخر أم المتابعة للدفع؟'
    );
    console.log(`✅ DEBUG: Post-item choice quick reply created: ${quickSid}`);
    
    await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, quickSid, {
      logLabel: 'Post item choice quick reply sent'
    });
    console.log(`✅ DEBUG: Post-item choice quick reply sent to ${phoneNumber}`);
  } catch (error) {
    console.error('❌ Error creating/sending quick reply:', error);
    console.log(`🔍 DEBUG: Sending fallback text message to ${phoneNumber}`);
    await sendTextMessage(
      client,
      TWILIO_WHATSAPP_FROM,
      phoneNumber,
      "هل ترغب في إضافة صنف آخر أم المتابعة للدفع؟ اكتب (إضافة) أو (دفع)."
    );
  }
  
  console.log(`🔍 DEBUG: finalizeItemQuantity completed for ${phoneNumber}`);
}

async function sendMenuCategories(phoneNumber: string) {
  try {
    await sendTextMessage(
      client,
      TWILIO_WHATSAPP_FROM,
      phoneNumber,
      '📋 إليك الفئات المتاحة، اختر ما يناسبك من القائمة التالية:'
    );
    const contentSid = await getCachedContentSid(
      'categories',
      () => createFoodListPicker(TWILIO_CONTENT_AUTH),
      'تصفح قائمتنا:'
    );
    await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, contentSid, {
      variables: { "1": "اليوم" },
      logLabel: 'Categories list picker sent'
    });
  } catch (error) {
    console.error(`❌ Error creating/sending dynamic list picker:`, error);
    const categoriesText = buildCategoriesFallback(FOOD_CATEGORIES);
    await sendTextMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, categoriesText);
  }
}

async function sendBranchSelection(phoneNumber: string) {
  try {
    await sendTextMessage(
      client,
      TWILIO_WHATSAPP_FROM,
      phoneNumber,
      '🏢 يرجى اختيار الفرع الذي تود استلام الطلب منه:'
    );
    const branchSid = await getCachedContentSid(
      'branch_list',
      () => createBranchListPicker(TWILIO_CONTENT_AUTH, PICKUP_BRANCHES),
      'اختر الفرع الأقرب لك:'
    );
    await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, branchSid, {
      logLabel: 'Branch list picker sent'
    });
  } catch (error) {
    console.error('❌ Error creating/sending branch list picker:', error);
    const fallback = `🏢 اختر الفرع الأقرب لك:\n\n${PICKUP_BRANCHES
      .map((branch, index) => `${index + 1}. ${branch.item} — ${branch.description}`)
      .join('\n')}\n\nاكتب اسم الفرع أو رقمه.`;
    await sendTextMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, fallback);
  }
}

// Main message processor - handles welcome and menu browsing
async function processMessage(phoneNumber: string, messageBody: string, messageType: string = 'text', extra: any = {}): Promise<void> {
  try {
    console.log(`🔍 DEBUG: Processing message from ${phoneNumber}: "${messageBody}" (type: ${messageType})`);
    
    // Only ignore unsupported types
    if (!['text', 'interactive', 'location'].includes(messageType)) {
      console.log(`📱 Ignoring unsupported message type from ${phoneNumber}: type=${messageType}`);
      return;
    }

    const profileName: string | undefined = extra?.profileName || extra?.profile_name || undefined;

    const trimmedBody = (messageBody || '').trim();
    const normalizedBody = trimmedBody.toLowerCase();
    const normalizedArabic = normalizedBody.replace(/[إأآ]/g, 'ا');
    const currentState = getOrderState(phoneNumber);
    recordInboundMessage(phoneNumber, trimmedBody || messageBody || '', messageType, {
      profileName,
      recipientPhone: TWILIO_WHATSAPP_FROM,
      botEnabled: globalBotEnabled,
    });

    if (!globalBotEnabled) {
      console.log(`🤖 Bot disabled globally. Skipping automated handling for ${phoneNumber}.`);
      return;
    }

    // Step 1: If first time, send welcome
    if (!welcomedUsers.has(phoneNumber)) {
      await sendWelcomeTemplate(phoneNumber, profileName);
      welcomedUsers.add(phoneNumber);
      console.log(`📱 Welcome message sent to new user: ${phoneNumber}`);
      return;
    }

    if (currentState.awaitingOrderReference && trimmedBody) {
      updateOrderState(phoneNumber, {
        awaitingOrderReference: false,
        lastQueriedReference: trimmedBody,
      });

      await sendTextMessage(
        client,
        TWILIO_WHATSAPP_FROM,
        phoneNumber,
        `شكرًا لك! سنبحث عن حالة الطلب رقم ${trimmedBody} ونوافيك بالتحديث قريبًا.`
      );
      return;
    }

    if (messageType === 'location') {
      const locationPayload = extra?.location ?? extra ?? {};
      let latitude: string = locationPayload.latitude || locationPayload.lat || '';
      let longitude: string = locationPayload.longitude || locationPayload.lon || '';
      let address: string = locationPayload.address || '';

      if ((!latitude || !longitude) && trimmedBody) {
        const match = trimmedBody.match(/(-?\d+(?:\.\d+)?)[^\d-]+(-?\d+(?:\.\d+)?)/);
        if (match && match[1] && match[2]) {
          latitude = latitude || match[1];
          longitude = longitude || match[2];
        } else if (!address) {
          address = trimmedBody;
        }
      }

      if (latitude && longitude) {
        address = await getReadableAddress(latitude, longitude, NOMINATIM_USER_AGENT);
      }

      if (!address) {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "تعذر قراءة الموقع. فضلاً أعد مشاركة موقعك مرة أخرى."
        );
        updateOrderState(phoneNumber, { awaitingLocation: true });
        return;
      }

      updateOrderState(phoneNumber, {
        locationAddress: address,
        latitude: latitude || undefined,
        longitude: longitude || undefined,
        awaitingLocation: false,
      });

      await sendTextMessage(
        client,
        TWILIO_WHATSAPP_FROM,
        phoneNumber,
        `✅ شكراً لك! تم استلام موقعك: ${address}.\nتصفّح القائمة لمتابعة الطلب.`
      );

      const updatedState = getOrderState(phoneNumber);
      if (updatedState.type === 'delivery') {
        await sendMenuCategories(phoneNumber);
      }
      return;
    }

    if (
      currentState.awaitingRemoval &&
      trimmedBody &&
      trimmedBody !== 'remove_item'
    ) {
      if (trimmedBody.startsWith('remove_item_')) {
        // Structured list reply ID; let the dedicated handler process it below.
      } else {
        const cart = getCart(phoneNumber);

        if (['cancel', 'إلغاء', 'الغاء'].some((term) => normalizedBody === term)) {
          updateOrderState(phoneNumber, { awaitingRemoval: false });
          await sendTextMessage(
            client,
            TWILIO_WHATSAPP_FROM,
            phoneNumber,
            'تم إلغاء عملية الحذف. هل ترغب في شيء آخر؟'
          );
          return;
        }

        if (!cart.length) {
          updateOrderState(phoneNumber, { awaitingRemoval: false });
          await sendTextMessage(
            client,
            TWILIO_WHATSAPP_FROM,
            phoneNumber,
            'السلة فارغة حالياً، لا توجد أصناف لحذفها.'
          );
          return;
        }

        let targetItem = undefined as CartItem | undefined;

        const indexCandidate = parseInt(trimmedBody, 10);
        if (!Number.isNaN(indexCandidate) && indexCandidate >= 1 && indexCandidate <= cart.length) {
          targetItem = cart[indexCandidate - 1];
        }

        if (!targetItem) {
          targetItem = cart.find(
            (item) => item.name.trim().toLowerCase() === normalizedBody
          );
        }

        if (!targetItem) {
          targetItem = cart.find((item) => item.name.trim().toLowerCase().includes(normalizedBody));
        }

        if (!targetItem) {
          await sendTextMessage(
            client,
            TWILIO_WHATSAPP_FROM,
            phoneNumber,
            'تعذر العثور على هذا الصنف في السلة. اكتب الاسم كما يظهر في السلة أو أرسل "إلغاء" للخروج.'
          );
          return;
        }

        removeItemFromCart(phoneNumber, targetItem.id);
        updateOrderState(phoneNumber, { awaitingRemoval: false });

        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          `تم حذف ${targetItem.name} من السلة.`
        );

        const updatedCart = getCart(phoneNumber);
        if (!updatedCart.length) {
          await sendTextMessage(
            client,
            TWILIO_WHATSAPP_FROM,
            phoneNumber,
            "أصبحت السلة فارغة الآن. اكتب 'طلب جديد' لإضافة أصناف."
          );
          return;
        }

        const updatedCartText = formatCartMessage(updatedCart);
        await sendTextMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, updatedCartText);

        try {
          const optionsSid = await getCachedContentSid(
            'cart_options',
            () => createCartOptionsQuickReply(TWILIO_CONTENT_AUTH),
            'هذه تفاصيل سلتك، ماذا تود أن تفعل؟'
          );
          await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, optionsSid, {
            logLabel: 'Cart options quick reply sent'
          });
        } catch (error) {
          console.error('❌ Error re-sending cart options after text removal:', error);
        }

        return;
      }
    }

    if (trimmedBody === 'send_location' ||
        normalizedBody.includes('send location') ||
        normalizedBody.includes('ارسل الموقع') ||
        normalizedBody.includes('أرسل الموقع') ||
        trimmedBody === '📍 إرسال الموقع') {
      await sendTextMessage(
        client,
        TWILIO_WHATSAPP_FROM,
        phoneNumber,
        "📍 لمشاركة موقعك: اضغط على رمز المشبك 📎 ثم اختر (الموقع) وأرسله."
      );
      updateOrderState(phoneNumber, { awaitingLocation: true });
      return;
    }

    if (trimmedBody === 'track_order' || normalizedBody.includes('track order') || normalizedBody.includes('تتبع')) {
      const state = getOrderState(phoneNumber);
      const cart = getCart(phoneNumber);
      if (!state.orderReference && !state.paymentMethod && !cart.length) {
        updateOrderState(phoneNumber, { awaitingOrderReference: true });
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          'من فضلك أرسل رقم الطلب الذي ترغب في تتبعه (مثال: ORD-12345).'
        );
        return;
      }

      if (!state.paymentMethod) {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          state.orderReference
            ? `طلبك رقم ${state.orderReference} قيد المراجعة. سنقوم بتحديثك فور تأكيده.`
            : 'طلبك لم يُأكد بعد. اختر وسيلة الدفع لإكماله ثم اطلب التتبع.'
        );
        return;
      }

      if ((state.statusStage ?? 0) < ORDER_STATUS_SEQUENCE.length) {
        await startOrderStatusSimulation(phoneNumber);
      }

      const referenceLine = state.orderReference
        ? `رقم الطلب: ${state.orderReference}`
        : 'رقم الطلب قيد الإنشاء.';
      const statusLine = state.lastStatusMessage
        ? state.lastStatusMessage
        : ORDER_STATUS_SEQUENCE[Math.min(state.statusStage ?? 0, ORDER_STATUS_SEQUENCE.length - 1)] || '🕒 طلبك قيد المراجعة.';
      const deliveryLine = state.type === 'delivery'
        ? state.locationAddress
          ? `سيتم التوصيل إلى: ${state.locationAddress}`
          : 'الموقع قيد التحديد.'
        : state.branchName
          ? `الاستلام من: ${state.branchName} (${state.branchAddress || 'سيتم التأكيد عند الوصول'})`
          : 'الاستلام من الفرع (سيتم تحديد الفرع).';

      await sendTextMessage(
        client,
        TWILIO_WHATSAPP_FROM,
        phoneNumber,
        `${referenceLine}\n${statusLine}\n${deliveryLine}\nيتم إرسال تحديث جديد كل دقيقة.`
      );
      return;
    }

    if (trimmedBody === 'contact_support' ||
        normalizedBody.includes('contact support') ||
        normalizedBody.includes('support') ||
        normalizedBody.includes('دعم')) {
      await sendTextMessage(
        client,
        TWILIO_WHATSAPP_FROM,
        phoneNumber,
        `☎️ للتواصل مع فريق الدعم يرجى الاتصال على ${SUPPORT_CONTACT} أو الرد هنا وسيقوم أحد موظفينا بمساعدتك.`
      );
      return;
    }

    const isNewOrderTrigger =
      trimmedBody === 'new_order' ||
      trimmedBody.includes('🆕') ||
      normalizedBody.includes('طلب جديد') ||
      normalizedBody.includes('new order');

    if (isNewOrderTrigger) {
      stopOrderStatusSimulation(phoneNumber);
      resetOrder(phoneNumber);
      try {
        const contentSid = await getCachedContentSid('order_type', () =>
          createOrderTypeQuickReply(TWILIO_CONTENT_AUTH)
        );
        await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, contentSid, {
          logLabel: 'Order type quick reply sent'
        });
      } catch (error) {
        console.error('❌ Error sending order type quick reply:', error);
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "يرجى الرد بكلمة (توصيل) أو (استلام) للمتابعة."
        );
      }
      return;
    }

    const isBrowseMenuTrigger =
      trimmedBody === 'browse_menu' ||
      trimmedBody.includes('🍽️') ||
      normalizedBody.includes('تصفح القائمة') ||
      normalizedBody.includes('browse') ||
      normalizedBody.includes('menu') ||
      normalizedBody.includes('قائمة');

    if (isBrowseMenuTrigger) {
      await sendMenuCategories(phoneNumber);
      return;
    }

    const isPickupSelection =
      trimmedBody === 'order_pickup' ||
      trimmedBody === '🏠 استلام' ||
      (normalizedArabic.includes('استلام') && !normalizedArabic.includes('الدفع'));

    if (trimmedBody === 'order_delivery' ||
        trimmedBody === '🛵 توصيل' ||
        normalizedBody.includes('توصيل')) {
      updateOrderState(phoneNumber, { type: 'delivery', awaitingLocation: true });
      try {
        const quickSid = await getCachedContentSid('location_request', () =>
          createLocationRequestQuickReply(TWILIO_CONTENT_AUTH)
        );
        await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, quickSid, {
          logLabel: 'Location request quick reply sent'
        });
      } catch (error) {
        console.error('❌ Error sending location request:', error);
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "📍 لمشاركة موقعك: اضغط على رمز المشبك 📎 ثم اختر (الموقع) وأرسله."
        );
      }
      return;
    }

    if (isPickupSelection) {
      updateOrderState(phoneNumber, {
        type: 'pickup',
        awaitingLocation: false,
        locationAddress: undefined,
        latitude: undefined,
        longitude: undefined,
        branchId: undefined,
        branchName: undefined,
        branchAddress: undefined,
      });
      await sendBranchSelection(phoneNumber);
      return;
    }

    if (trimmedBody.startsWith('branch_')) {
      const branch = findBranchById(trimmedBody);
      if (!branch) {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          'تعذر العثور على هذا الفرع. يرجى اختيار فرع من القائمة.'
        );
        await sendBranchSelection(phoneNumber);
        return;
      }

      updateOrderState(phoneNumber, {
        type: 'pickup',
        branchId: branch.id,
        branchName: branch.item,
        branchAddress: branch.description,
      });

      await sendTextMessage(
        client,
        TWILIO_WHATSAPP_FROM,
        phoneNumber,
        `✅ تم اختيار ${branch.item}. العنوان: ${branch.description}.`
      );
      await sendMenuCategories(phoneNumber);
      return;
    }

    if (
      currentState.type === 'pickup' &&
      !currentState.branchId &&
      trimmedBody &&
      !trimmedBody.startsWith('cat_') &&
      !trimmedBody.startsWith('item_')
    ) {
      const branch = findBranchByText(trimmedBody);
      if (branch) {
        updateOrderState(phoneNumber, {
          type: 'pickup',
          branchId: branch.id,
          branchName: branch.item,
          branchAddress: branch.description,
        });

        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          `✅ تم اختيار ${branch.item}. العنوان: ${branch.description}.`
        );
        await sendMenuCategories(phoneNumber);
        return;
      }

      // If no branch matched, remind the user to select from the list
      await sendTextMessage(
        client,
        TWILIO_WHATSAPP_FROM,
        phoneNumber,
        'تعذر فهم اسم الفرع، يرجى اختيار فرع من القائمة أو كتابة اسمه كما هو.'
      );
      await sendBranchSelection(phoneNumber);
      return;
    }

    // Step 2.5: If user selected a category from the list picker → show items
    if (trimmedBody.startsWith('cat_')) {
      const categoryId = trimmedBody;
      const category = findCategoryById(categoryId);
      if (!category) {
        console.log(`⚠️ Unknown category id: ${categoryId}`);
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "عذراً، لم يتم العثور على هذه الفئة. اكتب 'طلب جديد' للبدء من جديد."
        );
        return;
      }

      try {
        const contentSid = await getCachedContentSid(
          `items_list_${categoryId}`,
          () => createItemsListPicker(TWILIO_CONTENT_AUTH, categoryId, category.item),
          `اختر طبقاً من ${category.item}:`
        );
        await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, contentSid, {
          variables: { "1": category.item },
          logLabel: `Items list picker for ${categoryId} sent`
        });
      } catch (error) {
        console.error(`❌ Error creating/sending items list picker:`, error);
        // Fallback to simple text message with items
        const items = CATEGORY_ITEMS[categoryId] || [];
        const itemsText = `🍽️ اختر طبقاً من ${category.item}:

${items
  .map(
    (it, index) =>
      `${index + 1}. ${it.item}${it.description ? ` — ${it.description}` : ''} (${it.price} ${it.currency || 'ر.س'})`
  )
  .join('\n')}

اكتب رقم الطبق أو اسمه.`;
        await sendTextMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, itemsText);
      }
      return; // stop after sending items picker
    }

    // Step 2.6: If user selected an item → add to cart, send image, then quick-replies
    if (trimmedBody.startsWith('item_')) {
      const result = findItemById(trimmedBody);
      if (!result) {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "عذراً، لم يتم العثور على هذا الطبق. اكتب 'طلب جديد' للبدء من جديد."
        );
        return;
      }
      const picked = result.item;

      setPendingItem(phoneNumber, {
        id: picked.id,
        name: picked.item,
        price: picked.price,
        currency: picked.currency,
        image: picked.image,
      }, 1);

      await sendItemMediaMessage(
        phoneNumber,
        `✅ تم اختيار ${picked.item} (${picked.price} ${picked.currency || 'ر.س'})`,
        picked.image
      );

      try {
        const quantitySid = await getCachedContentSid('quantity_prompt', () =>
          createQuantityQuickReply(TWILIO_CONTENT_AUTH, picked.item, 1)
        );
        await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, quantitySid, {
          variables: {
            1: picked.item,
            2: '1',
          },
          logLabel: 'Quantity quick reply sent'
        });
      } catch (error) {
        console.error('❌ Error creating/sending quantity quick reply:', error);
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          `كم ترغب من ${picked.item}؟ اكتب العدد المطلوب (1-${MAX_ITEM_QUANTITY}).`
        );
      }
      return;
    }

    if (
      trimmedBody === '🔢 كمية أخرى' ||
      normalizedBody.includes('كمية اخرى') ||
      normalizedBody.includes('كمية أخرى')
    ) {
      const pendingState = getOrderState(phoneNumber);
      if (pendingState.pendingItem) {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          `من فضلك أرسل الكمية المطلوبة من ${pendingState.pendingItem.name} كرقم فقط (مثال: 4). المدى المسموح 1-${MAX_ITEM_QUANTITY}.`
        );
        updateOrderState(phoneNumber, {
          pendingQuantity: pendingState.pendingQuantity || 1,
        });
      } else {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          'فضلاً اختر طبقاً أولاً قبل تحديد الكمية.'
        );
      }
      return;
    }

    const numericQuantity = parseInt(trimmedBody, 10);
    if (!Number.isNaN(numericQuantity) && numericQuantity > 0) {
      if (numericQuantity > MAX_ITEM_QUANTITY) {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          `يمكنك طلب حتى ${MAX_ITEM_QUANTITY} حصص في كل مرة. الرجاء إرسال رقم ضمن النطاق.`
        );
        return;
      }

      const pendingState = getOrderState(phoneNumber);
      if (pendingState.pendingItem) {
        await finalizeItemQuantity(
          phoneNumber,
          pendingState.pendingItem,
          numericQuantity
        );
        return;
      }

      if (pendingState.awaitingRemoval) {
        // fall through to removal handling below
      } else {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          'فضلاً اختر طبقاً أولاً قبل تحديد الكمية.'
        );
        return;
      }
    }

    if (trimmedBody.startsWith('qty_')) {
      console.log(`🔍 DEBUG: Quantity selection detected: ${trimmedBody}`);
      console.log(`🔍 DEBUG: Current state:`, JSON.stringify(currentState, null, 2));
      
      const pendingItem = currentState.pendingItem;
      if (!pendingItem) {
        console.log(`❌ DEBUG: No pending item found for ${phoneNumber}`);
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "فضلاً اختر طبقاً من القائمة أولاً."
        );
        return;
      }

      let quantity = currentState.pendingQuantity || 1;
      console.log(`🔍 DEBUG: Initial quantity: ${quantity}`);
      
      switch (trimmedBody) {
        case 'qty_1':
          quantity = 1;
          break;
        case 'qty_2':
          quantity = 2;
          break;
        case 'qty_custom':
          await sendTextMessage(
            client,
            TWILIO_WHATSAPP_FROM,
            phoneNumber,
            `من فضلك أرسل الكمية المطلوبة من ${pendingItem.name} كرقم فقط (مثال: 4). المدى المسموح 1-${MAX_ITEM_QUANTITY}.`
          );
          updateOrderState(phoneNumber, { pendingQuantity: quantity });
          return;
        default:
          break;
      }

      console.log(`🔍 DEBUG: Final quantity: ${quantity}, calling finalizeItemQuantity`);
      await finalizeItemQuantity(phoneNumber, pendingItem, quantity);
      console.log(`✅ DEBUG: finalizeItemQuantity completed for ${phoneNumber}`);
      return;
    }

    // Step 2.7: Handle quick reply actions
    const isAddItemTrigger =
      trimmedBody === 'add_item' ||
      normalizedBody.includes('add item') ||
      normalizedBody.includes('اضف صنف') ||
      normalizedBody.includes('اضافة صنف') ||
      normalizedArabic.includes('اضف صنف') ||
      normalizedArabic.includes('اضافة صنف');

    if (isAddItemTrigger) {
      // (unchanged) → creates categories list again
      await sendMenuCategories(phoneNumber);
      return;
    }

    if (trimmedBody === 'view_cart' || normalizedBody.includes('view cart') || normalizedBody.includes('عرض السلة')) {
      const cart = getCart(phoneNumber);
      const cartText = formatCartMessage(cart);
      await sendTextMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, cartText);

      if (!cart.length) {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "سلتك فارغة. اكتب 'طلب جديد' لبدء طلب جديد."
        );
        return;
      }

      try {
        const optionsSid = await getCachedContentSid(
          'cart_options',
          () => createCartOptionsQuickReply(TWILIO_CONTENT_AUTH),
          'هذه تفاصيل سلتك، ماذا تود أن تفعل؟'
        );
        await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, optionsSid, {
          logLabel: 'Cart options quick reply sent'
        });
      } catch (error) {
        console.error('❌ Error sending cart options:', error);
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "اكتب: إضافة لمتابعة التسوق، إزالة لحذف صنف، أو دفع لإتمام الطلب."
        );
      }
      return;
    }

    const isRemoveItemTrigger =
      trimmedBody === 'remove_item' ||
      normalizedBody.includes('remove item') ||
      normalizedBody.includes('delete item') ||
      normalizedBody.includes('remove from cart') ||
      normalizedBody.includes('ازاله صنف') ||
      normalizedBody.includes('إزالة صنف') ||
      normalizedBody.includes('حذف صنف') ||
      normalizedBody.includes('احذف صنف') ||
      normalizedArabic.includes('ازاله صنف') ||
      normalizedArabic.includes('ازالة صنف') ||
      normalizedArabic.includes('حذف صنف') ||
      normalizedArabic.includes('احذف صنف');

    if (isRemoveItemTrigger) {
      const cart = getCart(phoneNumber);
      if (!cart.length) {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "السلة فارغة، لا توجد أصناف للحذف."
        );
        return;
      }

      updateOrderState(phoneNumber, { awaitingRemoval: true });

      try {
        const removeSid = await createRemoveItemListQuickReply(
          TWILIO_CONTENT_AUTH,
          cart.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            currency: item.currency,
          }))
        );
        registerTemplateTextForSid(removeSid, 'اختر الصنف الذي ترغب في حذفه من السلة:');
        await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, removeSid, {
          logLabel: 'Remove item list sent'
        });
      } catch (error) {
        console.error('❌ Error sending remove item list:', error);
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "اكتب اسم الصنف الذي ترغب في حذفه أو أرسل رقمه كما يظهر في السلة."
        );
      }
      return;
    }

    if (trimmedBody.startsWith('remove_item_')) {
      const itemId = trimmedBody.replace('remove_item_', '');
      const cart = getCart(phoneNumber);
      const entry = cart.find((item) => item.id === itemId);
      if (!entry) {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "هذا الصنف غير موجود في السلة."
        );
        return;
      }

      removeItemFromCart(phoneNumber, itemId);
      updateOrderState(phoneNumber, { awaitingRemoval: false });
      await sendTextMessage(
        client,
        TWILIO_WHATSAPP_FROM,
        phoneNumber,
        `تم حذف ${entry.name} من السلة.`
      );

      const cartAfterRemoval = getCart(phoneNumber);
      if (!cartAfterRemoval.length) {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "أصبحت السلة فارغة الآن. اكتب 'طلب جديد' لإضافة أصناف."
        );
        return;
      }

      const updatedCartText = formatCartMessage(cartAfterRemoval);
      await sendTextMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, updatedCartText);

      try {
        const optionsSid = await getCachedContentSid(
          'cart_options',
          () => createCartOptionsQuickReply(TWILIO_CONTENT_AUTH),
          'هذه تفاصيل سلتك، ماذا تود أن تفعل؟'
        );
        await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, optionsSid, {
          logLabel: 'Cart options quick reply sent'
        });
      } catch (error) {
        console.error('❌ Error re-sending cart options:', error);
      }
      return;
    }

    if (trimmedBody === 'checkout' ||
        normalizedBody.includes('checkout') ||
        normalizedBody.includes('إتمام') ||
        trimmedBody === '🛒 المتابعة للدفع') {
      const cart = getCart(phoneNumber);
      if (!cart.length) {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "سلتك فارغة، أضف أصنافاً قبل إتمام الطلب."
        );
        return;
      }

      const checkoutState = getOrderState(phoneNumber);
      if (checkoutState.type === 'delivery' && !checkoutState.locationAddress) {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "فضلاً شارك موقع التوصيل أولاً حتى نتمكن من حساب رسوم التوصيل."
        );
        try {
          const locationSid = await getCachedContentSid('location_request', () =>
            createLocationRequestQuickReply(TWILIO_CONTENT_AUTH)
          );
          await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, locationSid, {
            logLabel: 'Location request quick reply sent'
          });
        } catch (error) {
          console.error('❌ Error re-sending location request during checkout:', error);
        }
        return;
      }

      if (checkoutState.type === 'pickup' && !checkoutState.branchId) {
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          'فضلاً اختر الفرع الذي تود الاستلام منه قبل إتمام الطلب.'
        );
        await sendBranchSelection(phoneNumber);
        return;
      }

      let orderReference = checkoutState.orderReference;
      if (!orderReference) {
        orderReference = generateOrderReference();
        updateOrderState(phoneNumber, {
          orderReference,
          statusStage: 0,
          lastStatusMessage: ORDER_STATUS_SEQUENCE[0],
        });
      }

      const { total, currency } = calculateCartTotal(cart);
      const summaryLines = cart.map(
        (item) => {
          const lineTotal = Number((item.price * item.quantity).toFixed(2));
          return `- ${item.quantity} × ${item.name} (${lineTotal} ${item.currency || currency || 'ر.س'})`;
        }
      );
      const locationLine =
        checkoutState.type === 'delivery'
          ? checkoutState.locationAddress
            ? `التوصيل إلى: ${checkoutState.locationAddress}`
            : 'سيتم تحديد موقع التوصيل لاحقاً'
          : checkoutState.branchName
            ? `الاستلام من: ${checkoutState.branchName} (${checkoutState.branchAddress || 'سيتم التأكيد عند الوصول'})`
            : 'الاستلام من الفرع (سيتم تحديد الفرع لاحقاً).';

      const summaryText = `رقم الطلب: ${orderReference}\n\nملخص الطلب:\n${summaryLines.join('\n')}\n\nالإجمالي: ${total} ${currency || 'ر.س'}\n${locationLine}\n\nاختر وسيلة الدفع:`;
      await sendTextMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, summaryText);

      try {
        const paymentSid = await getCachedContentSid(
          'payment_options',
          () => createPaymentOptionsQuickReply(TWILIO_CONTENT_AUTH),
          'اختر وسيلة الدفع:'
        );
        await sendContentMessage(client, TWILIO_WHATSAPP_FROM, phoneNumber, paymentSid, {
          logLabel: 'Payment options quick reply sent'
        });
      } catch (error) {
        console.error('❌ Error sending payment options:', error);
        await sendTextMessage(
          client,
          TWILIO_WHATSAPP_FROM,
          phoneNumber,
          "اكتب (إلكتروني) أو (نقدي) لتحديد وسيلة الدفع."
        );
      }
      return;
    }

    if (trimmedBody === 'pay_online' || normalizedBody.includes('pay online') || trimmedBody === '💳 pay online' || normalizedBody.includes('دفع إلكتروني')) {
      updateOrderState(phoneNumber, { paymentMethod: 'online' });
      let paymentState = getOrderState(phoneNumber);
      if (!paymentState.orderReference) {
        const newRef = generateOrderReference();
        updateOrderState(phoneNumber, {
          orderReference: newRef,
          statusStage: 0,
          lastStatusMessage: ORDER_STATUS_SEQUENCE[0],
        });
        paymentState = getOrderState(phoneNumber);
      }
      await sendTextMessage(
        client,
        TWILIO_WHATSAPP_FROM,
        phoneNumber,
        `اضغط على الرابط لإتمام عملية الدفع 💳\n${PAYMENT_LINK}`
      );
      await sendTextMessage(
        client,
        TWILIO_WHATSAPP_FROM,
        phoneNumber,
        `سنبدأ بتحضير طلبك فور تأكيد عملية الدفع. سيتم إرسال التحديثات على رقم الطلب ${paymentState.orderReference}.`
      );
      await startOrderStatusSimulation(phoneNumber);
      return;
    }

    if (trimmedBody === 'pay_cash' ||
        normalizedBody.includes('cash on delivery') ||
        normalizedBody.includes('cash') ||
        normalizedBody.includes('نقدي') ||
        normalizedArabic.includes('الدفع عند الاستلام')) {
      updateOrderState(phoneNumber, { paymentMethod: 'cash' });
      let paymentState = getOrderState(phoneNumber);
      if (!paymentState.orderReference) {
        const newRef = generateOrderReference();
        updateOrderState(phoneNumber, {
          orderReference: newRef,
          statusStage: 0,
          lastStatusMessage: ORDER_STATUS_SEQUENCE[0],
        });
        paymentState = getOrderState(phoneNumber);
      }

      const orderReference = paymentState.orderReference!;

      const fulfillmentLine = paymentState.type === 'pickup'
        ? paymentState.branchName
          ? `رجاء استلام طلبك من ${paymentState.branchName} (العنوان: ${paymentState.branchAddress || 'سيتم التأكيد عند الوصول'}).`
          : 'سننتظرك في الفرع المحدد لاستلام طلبك.'
        : paymentState.locationAddress
          ? `سيتم تحصيل المبلغ عند التسليم إلى العنوان: ${paymentState.locationAddress}.`
          : 'سيتم التواصل معك لتأكيد عنوان التوصيل قبل التسليم.';

      await sendTextMessage(
        client,
        TWILIO_WHATSAPP_FROM,
        phoneNumber,
        `✔️ تم اختيار الدفع نقداً عند الاستلام. ${fulfillmentLine}\nرقم طلبك هو ${orderReference}.`
      );
      await startOrderStatusSimulation(phoneNumber);
      return;
    }

    // Step 3: For all other messages, just log (no response)
    console.log(`📱 Message received from returning user: ${phoneNumber} -> ${messageBody}`);

  } catch (error) {
    console.error('❌ Error processing message:', error);
    // Don't send any error messages back to user
  }
}

// Webhook server
const server = Bun.serve({
  port: PORT,
  async fetch(req: Request, server): Promise<Response> {
    const url = new URL(req.url);
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

    if (req.method === 'GET' && url.pathname === '/api/conversations') {
      const data = getConversations().map(mapConversationToApi);
      return jsonResponse(data);
    }

    if (req.method === 'GET' && /^\/api\/conversations\//.test(url.pathname)) {
      const messagesMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (messagesMatch) {
        const conversationIdRaw = messagesMatch[1];
        if (!conversationIdRaw) {
          return jsonResponse({ error: 'Conversation id required' }, 400);
        }
        const normalizedId = normalizePhoneNumber(decodeURIComponent(conversationIdRaw));
        const messages = getConversationMessages(normalizedId);
        if (!messages.length && !getConversationById(normalizedId)) {
          return jsonResponse({ error: 'Conversation not found' }, 404);
        }
        markConversationRead(normalizedId);
        return jsonResponse(messages.map(mapMessageToApi));
      }
    }

    if (req.method === 'POST' && /^\/api\/conversations\//.test(url.pathname)) {
      const sendMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/send$/);
      if (sendMatch) {
        const conversationIdRaw = sendMatch[1];
        if (!conversationIdRaw) {
          return jsonResponse({ error: 'Conversation id required' }, 400);
        }
        const normalizedId = normalizePhoneNumber(decodeURIComponent(conversationIdRaw));
        const body = (await req.json().catch(() => ({}))) as { message?: string };
        const messageText = typeof body.message === 'string' ? body.message.trim() : '';
        if (!messageText) {
          return jsonResponse({ error: 'Message is required' }, 400);
        }

        try {
          getOrCreateConversation(normalizedId);
          await sendTextMessage(client, TWILIO_WHATSAPP_FROM, normalizedId, messageText);
          markConversationRead(normalizedId);
          setConversationData(normalizedId, { status: 'active', isBotActive: globalBotEnabled });
          const messages = getConversationMessages(normalizedId);
          const lastMessage = messages[messages.length - 1];
          if (!lastMessage) {
            return jsonResponse({ message: null }, 202);
          }
          return jsonResponse({ message: mapMessageToApi(lastMessage) });
        } catch (error) {
          console.error('❌ Failed to send manual message:', error);
          return jsonResponse({ error: 'Failed to send message' }, 500);
        }
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/bot/toggle') {
      const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
      if (typeof body.enabled !== 'boolean') {
        return jsonResponse({ error: '`enabled` boolean is required' }, 400);
      }
      globalBotEnabled = body.enabled;
      getConversations().forEach((conversation) => {
        setConversationData(conversation.id, { isBotActive: globalBotEnabled });
      });
      notifyBotStatus(globalBotEnabled);
      return jsonResponse({ enabled: globalBotEnabled });
    }
    
    // Handle webhook verification
    if (req.method === 'GET' && url.pathname === '/webhook') {
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

    // Handle incoming messages
    if (req.method === 'POST' && url.pathname === '/webhook') {
      try {
        const contentType = req.headers.get('content-type') || '';

        // Handle Twilio webhook (application/x-www-form-urlencoded)
        if (contentType.includes('application/x-www-form-urlencoded')) {
          const raw = await req.text();
          const params = new URLSearchParams(raw);
          const from = (params.get('From') || '').replace(/^whatsapp:/, '').replace(/^\+/, '');
          const bodyText = params.get('Body') || '';
          const profileName = params.get('ProfileName') || '';
          
          // Twilio form webhook can include location fields when user shares location
          const latitude = params.get('Latitude');
          const longitude = params.get('Longitude');
          const addressParam = params.get('Address') || params.get('AddressStatus') || '';
          if (from && (latitude || longitude)) {
            const locText = addressParam
              ? addressParam
              : `📍 موقع: ${latitude || '??'}, ${longitude || '??'}`;
            console.log(`📍 Twilio location received from ${from}: ${locText}`);
            const locationExtra: any = {
              location: {
                latitude: latitude || undefined,
                longitude: longitude || undefined,
                address: addressParam || undefined,
              }
            };
            if (profileName) {
              locationExtra.profileName = profileName;
            }
            await processMessage(from, locText, 'location', locationExtra);
            return new Response(null, { status: 200 });
          }
          
          console.log('📨 Twilio webhook received:', Object.fromEntries(params.entries()));

          if (from && bodyText) {
            console.log(`📱 Processing Twilio message: ${from} -> ${bodyText}`);
            const textExtra: any = {};
            if (profileName) {
              textExtra.profileName = profileName;
            }
            await processMessage(from, bodyText, 'text', textExtra);
          }

          return new Response(null, { status: 200 });
        }

        // Handle Meta webhook (application/json)
        const body: any = await req.json();
        console.log('📨 Meta webhook received:', JSON.stringify(body, null, 2));

        if (body.object === 'whatsapp_business_account') {
          body.entry?.forEach((entry: any) => {
            entry.changes?.forEach((change: any) => {
              if (change.field === 'messages') {
                const value = change.value;
                
                if (value.messages) {
                  value.messages.forEach(async (message: any) => {
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

                    switch (messageType) {
                      case 'text':
                        messageBody = message.text?.body || '';
                        console.log(`🔍 DEBUG: Text message received: "${messageBody}"`);
                        break;
                      case 'interactive':
                        if (message.interactive?.type === 'button_reply') {
                          messageBody = message.interactive.button_reply?.id || '';
                          console.log(`🔍 DEBUG: Button reply received: "${messageBody}"`);
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
                  });
                }
              }
            });
          });
        }

        return new Response(null, { status: 200 });
      } catch (error) {
        console.error('❌ Error processing webhook:', error);
        return new Response('Internal Server Error', { status: 500 });
      }
    }

    // Health check endpoint
    if (req.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        welcomedUsers: welcomedUsers.size,
        activeCarts: getActiveCartsCount(),
        botEnabled: globalBotEnabled,
      });
    }

    return new Response('Not Found', { status: 404 });
  },
  websocket: {
    open(ws: Bun.ServerWebSocket<any>) {
      registerWebsocketClient(ws);
      ws.send(JSON.stringify({ type: 'connection', data: 'connected' }));
      ws.send(JSON.stringify({ type: 'conversation.bootstrap', data: getConversations().map(mapConversationToApi) }));
      ws.send(JSON.stringify({ type: 'bot.status', data: { enabled: globalBotEnabled } }));
    },
    close(ws: Bun.ServerWebSocket<any>) {
      removeWebsocketClient(ws);
    },
    message(ws: Bun.ServerWebSocket<any>, message: string | Uint8Array) {
      const text =
        typeof message === 'string'
          ? message
          : new TextDecoder().decode(message);
      if (text === 'ping') {
        ws.send('pong');
      }
    },
  },
});
