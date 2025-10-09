import twilio from 'twilio';
import crypto from 'crypto';
import { processInboundWebhook } from './src/webhooks/inboundHandler';
import type { CartItem, OrderType } from './src/types';
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
import {
  clearConversationSession,
  getConversationSession,
  updateConversationSession,
  type ConversationSession,
  type SessionOrderItem,
} from './src/state/session';

import { sendContentMessage, sendTextMessage } from './src/twilio/messaging';
import { createContent } from './src/twilio/content';
import { ensureWhatsAppAddress, normalizePhoneNumber, standardizeWhatsappNumber } from './src/utils/phone';
import { buildCategoriesFallback, matchesAnyTrigger } from './src/utils/text';
import { getReadableAddress } from './src/utils/geocode';
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
  WHATSAPP_SEND_TOKEN,
} from './src/config';
import {
  MAX_ITEM_QUANTITY,
  getMenuCategories,
  getCategoryById,
  findCategoryByText,
  getCategoryItems,
  getItemById,
  findItemByText,
  getMerchantBranches,
  getBranchById,
  findBranchByText,
  type MenuCategory,
  type MenuItem,
  type BranchOption,
} from './src/workflows/menuData';
import { getRestaurantByWhatsapp, type SufrahRestaurant } from './src/db/sufrahRestaurantService';
import { findOrCreateConversation as findOrCreateDbConversation, updateConversation as updateDbConversation } from './src/db/conversationService';
import { createInboundMessage } from './src/db/messageService';
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
import { submitExternalOrder, OrderSubmissionError } from './src/services/orderSubmission';
import { sendNotification, consumeCachedMessageForPhone } from './src/services/whatsapp';

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
seedCacheFromKey('rating_list', process.env.CONTENT_SID_RATING_LIST || '');

const baseHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,ngrok-skip-browser-warning',
};

const DEFAULT_CURRENCY = 'ر.س';

function roundToTwo(value: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number(value.toFixed(2));
  }
  const parsed = Number.parseFloat(String(value ?? 0));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function toExternalOrderType(type: OrderType | undefined): string | undefined {
  if (!type) {
    return undefined;
  }
  const normalized = `${type}`.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
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

function toSessionOrderItems(cart: CartItem[]): SessionOrderItem[] {
  return cart.map((item) => ({
    productId: item.id,
    name: item.name,
    quantity: item.quantity,
    unitPrice: roundToTwo(item.price),
    currency: item.currency,
    notes: item.notes,
    addons: (item.addons ?? []).map((addon) => ({
      id: addon.id,
      name: addon.name,
      price: roundToTwo(addon.price),
      quantity: addon.quantity,
      currency: addon.currency ?? item.currency,
    })),
  }));
}

function buildCartSummary(cart: CartItem[]): { lines: string[]; total: number; currency: string } {
  const { total, currency } = calculateCartTotal(cart);
  const fallbackCurrency = currency || DEFAULT_CURRENCY;
  const lines = cart.flatMap((item) => {
    const itemCurrency = item.currency || fallbackCurrency;
    const baseTotal = roundToTwo(item.price * item.quantity);
    const baseLine = `- ${item.name} x${item.quantity} = ${baseTotal} ${itemCurrency}`;
    const addonLines = (item.addons ?? []).map((addon) => {
      const addonCurrency = addon.currency || itemCurrency || fallbackCurrency;
      const addonTotal = roundToTwo(addon.price * addon.quantity);
      return `  • ${addon.name} x${addon.quantity} = ${addonTotal} ${addonCurrency}`;
    });
    return [baseLine, ...addonLines];
  });
  return { lines, total, currency: fallbackCurrency };
}

async function syncSessionWithCart(
  conversationId: string,
  phoneNumber: string,
  overrides: Partial<ConversationSession> = {}
): Promise<void> {
  const cart = getCart(phoneNumber);
  const state = getOrderState(phoneNumber);
  const { total, currency } = calculateCartTotal(cart);

  const update: Partial<ConversationSession> = {
    merchantId: state.restaurant?.externalMerchantId,
    orderType: toExternalOrderType(state.type),
    paymentMethod: toExternalPaymentMethod(state.paymentMethod),
    items: toSessionOrderItems(cart),
    total,
    currency: currency || DEFAULT_CURRENCY,
    customerName: state.customerName,
    customerPhone: standardizeWhatsappNumber(phoneNumber) || phoneNumber,
    branchId: state.branchId,
    branchName: state.branchName,
    ...overrides,
  };

  if (!cart.length) {
    update.items = [];
    update.total = 0;
  }

  await updateConversationSession(conversationId, update);
}

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
export async function sendWelcomeTemplate(
  to: string,
  profileName?: string,
  restaurantName?: string
) {
  const safeRestaurantName = restaurantName?.trim() || process.env.RESTAURANT_NAME || 'مطعم XYZ';
  const safeGuestName = profileName || 'ضيفنا الكريم';
  try {
    if (!welcomeContentSid) {
      const created = await client.content.v1.contents.create({
        friendly_name: `welcome_qr_${Date.now()}`,
        language: "ar",
        variables: {
          "1": safeRestaurantName,
          "2": safeGuestName,
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
        1: safeRestaurantName,
        2: safeGuestName,
      },
      logLabel: 'Welcome template sent'
    });
  } catch (error) {
    console.error("❌ Error in sendWelcomeTemplate:", error);

    // fallback: plain text
    const fallback = `🌟 أهلاً بك يا ${safeGuestName} في ${safeRestaurantName}! 🌟

🍽️ لبدء طلب جديد اكتب "طلب جديد" أو اضغط على زر 🆕.`;
    return sendTextMessage(client, TWILIO_WHATSAPP_FROM, to, fallback);
  }
}




async function sendItemMediaMessage(
  fromNumber: string,
  phoneNumber: string,
  body: string,
  imageUrl?: string
): Promise<void> {
  if (!imageUrl) {
    await sendTextMessage(client, fromNumber, phoneNumber, body);
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
  await sendContentMessage(client, fromNumber, phoneNumber, contentSid, {
    logLabel: 'Item media message sent'
  });
}

async function finalizeItemQuantity(
  fromNumber: string,
  phoneNumber: string,
  conversationId: string,
  pendingItem: Omit<CartItem, 'quantity'>,
  quantity: number
): Promise<void> {
  console.log(`🔍 DEBUG: finalizeItemQuantity called for ${phoneNumber}, item: ${pendingItem.name}, quantity: ${quantity}`);
  
  const addedItem = addItemToCart(phoneNumber, pendingItem, quantity);
  console.log(`✅ DEBUG: Item added to cart for ${phoneNumber}`);
  
  setPendingItem(phoneNumber, undefined);
  updateOrderState(phoneNumber, { pendingQuantity: undefined });
  console.log(`✅ DEBUG: Pending item cleared for ${phoneNumber}`);

  const currency = pendingItem.currency || addedItem.currency || DEFAULT_CURRENCY;
  const addonsTotal = (pendingItem.addons ?? []).reduce(
    (sum, addon) => sum + addon.price * addon.quantity,
    0
  );
  const lineTotal = roundToTwo(pendingItem.price * quantity + addonsTotal);
  const additionText = `✅ تم إضافة ${quantity} × ${pendingItem.name} إلى السلة (الإجمالي ${lineTotal} ${currency})`;
  
  console.log(`🔍 DEBUG: Sending confirmation message to ${phoneNumber}: "${additionText}"`);
  
  if (pendingItem.image) {
    console.log(`🔍 DEBUG: Sending media message with image for ${phoneNumber}`);
    await sendItemMediaMessage(fromNumber, phoneNumber, additionText, pendingItem.image);
  } else {
    console.log(`🔍 DEBUG: Sending text message for ${phoneNumber}`);
    await sendTextMessage(client, fromNumber, phoneNumber, additionText);
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
    
    await sendContentMessage(client, fromNumber, phoneNumber, quickSid, {
      logLabel: 'Post item choice quick reply sent'
    });
    console.log(`✅ DEBUG: Post-item choice quick reply sent to ${phoneNumber}`);
  } catch (error) {
    console.error('❌ Error creating/sending quick reply:', error);
    console.log(`🔍 DEBUG: Sending fallback text message to ${phoneNumber}`);
    await sendTextMessage(
      client,
      fromNumber,
      phoneNumber,
      "هل ترغب في إضافة صنف آخر أم المتابعة للدفع؟ اكتب (إضافة) أو (دفع)."
    );
  }
  
  await syncSessionWithCart(conversationId, phoneNumber);
  
  console.log(`🔍 DEBUG: finalizeItemQuantity completed for ${phoneNumber}`);
}

async function sendMenuCategories(
  fromNumber: string,
  phoneNumber: string,
  merchantId: string
) {
  let categories: MenuCategory[] = [];
  try {
    categories = await getMenuCategories(merchantId);
  } catch (error) {
    console.error('❌ Failed to fetch categories from Sufrah API:', error);
    await sendTextMessage(
      client,
      fromNumber,
      phoneNumber,
      '⚠️ الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً.'
    );
    return;
  }

  if (!categories.length) {
    await sendTextMessage(
      client,
      fromNumber,
      phoneNumber,
      '⚠️ لا توجد فئات متاحة في القائمة حالياً.'
    );
    return;
  }

  await sendTextMessage(
    client,
    fromNumber,
    phoneNumber,
    '📋 إليك الفئات المتاحة، اختر ما يناسبك من القائمة التالية:'
  );

  try {
    const cacheKey = `categories:${merchantId}`;
    const contentSid = await getCachedContentSid(
      cacheKey,
      () => createFoodListPicker(TWILIO_CONTENT_AUTH, categories),
      'تصفح قائمتنا:'
    );
    await sendContentMessage(client, fromNumber, phoneNumber, contentSid, {
      variables: { "1": "اليوم" },
      logLabel: 'Categories list picker sent'
    });
  } catch (error) {
    console.error('❌ Error creating/sending dynamic list picker:', error);
    const categoriesText = buildCategoriesFallback(categories);
    await sendTextMessage(client, fromNumber, phoneNumber, categoriesText);
  }
}

async function sendBranchSelection(
  fromNumber: string,
  phoneNumber: string,
  merchantId: string
) {
  let branches: BranchOption[] = [];
  try {
    branches = await getMerchantBranches(merchantId);
  } catch (error) {
    console.error('❌ Failed to fetch branches from Sufrah API:', error);
    await sendTextMessage(
      client,
      fromNumber,
      phoneNumber,
      '⚠️ الخدمة غير متاحة حالياً، يرجى المحاولة لاحقاً.'
    );
    return;
  }

  if (!branches.length) {
    await sendTextMessage(
      client,
      fromNumber,
      phoneNumber,
      '⚠️ لا تتوفر فروع للاستلام حالياً.'
    );
    return;
  }

  await sendTextMessage(
    client,
    fromNumber,
    phoneNumber,
    '🏢 يرجى اختيار الفرع الذي تود استلام الطلب منه:'
  );

  try {
    const cacheKey = `branch_list:${merchantId}`;
    const branchSid = await getCachedContentSid(
      cacheKey,
      () => createBranchListPicker(TWILIO_CONTENT_AUTH, branches),
      'اختر الفرع الأقرب لك:'
    );
    await sendContentMessage(client, fromNumber, phoneNumber, branchSid, {
      logLabel: 'Branch list picker sent'
    });
  } catch (error) {
    console.error('❌ Error creating/sending branch list picker:', error);
    const fallback = `🏢 اختر الفرع الأقرب لك:\n\n${branches
      .map((branch, index) => `${index + 1}. ${branch.item} — ${branch.description}`)
      .join('\n')}\n\nاكتب اسم الفرع أو رقمه.`;
    await sendTextMessage(client, fromNumber, phoneNumber, fallback);
  }
}

async function resolveRestaurantContext(
  phoneNumber: string,
  recipientPhone?: string
): Promise<SufrahRestaurant | null> {
  const state = getOrderState(phoneNumber);
  const fallbackRecipient =
    recipientPhone || state.restaurant?.whatsappNumber || TWILIO_WHATSAPP_FROM;
  const standardizedRecipient = standardizeWhatsappNumber(fallbackRecipient);

  if (!standardizedRecipient) {
    return null;
  }

  if (
    state.restaurant &&
    standardizeWhatsappNumber(state.restaurant.whatsappNumber) === standardizedRecipient
  ) {
    return state.restaurant;
  }

  try {
    const restaurant = await getRestaurantByWhatsapp(standardizedRecipient);
    if (!restaurant) {
      return null;
    }

    const normalizedRestaurant: SufrahRestaurant = {
      ...restaurant,
      whatsappNumber: standardizeWhatsappNumber(restaurant.whatsappNumber),
    };

    updateOrderState(phoneNumber, { restaurant: normalizedRestaurant });
    return normalizedRestaurant;
  } catch (error) {
    console.error('❌ Failed to resolve restaurant by WhatsApp number:', error);
    return null;
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
    const recipientPhoneRaw: string | undefined =
      extra?.recipientPhone ||
      extra?.to ||
      extra?.botNumber ||
      extra?.recipient_phone ||
      TWILIO_WHATSAPP_FROM;

    const restaurantContext = await resolveRestaurantContext(phoneNumber, recipientPhoneRaw);
    const fallbackFrom = standardizeWhatsappNumber(recipientPhoneRaw || TWILIO_WHATSAPP_FROM) || TWILIO_WHATSAPP_FROM;
    const fromNumber = restaurantContext?.whatsappNumber || fallbackFrom;
    const merchantId = restaurantContext?.externalMerchantId;

    let currentState = getOrderState(phoneNumber);
    if (restaurantContext && (!currentState.restaurant || currentState.restaurant.id !== restaurantContext.id)) {
      updateOrderState(phoneNumber, { restaurant: restaurantContext });
      currentState = getOrderState(phoneNumber);
    }

    if (profileName && profileName.trim().length) {
      updateOrderState(phoneNumber, { customerName: profileName.trim() });
      currentState = getOrderState(phoneNumber);
    }

    const trimmedBody = (messageBody || '').trim();
    const normalizedBody = trimmedBody.toLowerCase();
    const normalizedArabic = normalizedBody.replace(/[إأآ]/g, 'ا');
    const conversationId = normalizePhoneNumber(phoneNumber);

    recordInboundMessage(phoneNumber, trimmedBody || messageBody || '', messageType, {
      profileName,
      recipientPhone: fromNumber,
      botEnabled: globalBotEnabled,
    });

    if (!restaurantContext) {
      await sendTextMessage(
        client,
        fromNumber,
        phoneNumber,
        '❌ لم يتم العثور على مطعم مرتبط بهذا الرقم.'
      );
      return;
    }

    const sessionBaseUpdate: Partial<ConversationSession> = {
      customerPhone: standardizeWhatsappNumber(phoneNumber) || phoneNumber,
    };
    if (restaurantContext.externalMerchantId) {
      sessionBaseUpdate.merchantId = restaurantContext.externalMerchantId;
    }
    if (currentState.customerName) {
      sessionBaseUpdate.customerName = currentState.customerName;
    }
    await updateConversationSession(conversationId, sessionBaseUpdate);

    if (!merchantId) {
      await sendTextMessage(
        client,
        fromNumber,
        phoneNumber,
        '⚠️ الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً.'
      );
      return;
    }

    if (!globalBotEnabled) {
      console.log(`🤖 Bot disabled globally. Skipping automated handling for ${phoneNumber}.`);
      return;
    }

    const sendBotText = (text: string) =>
      sendTextMessage(client, fromNumber, phoneNumber, text);
    const sendBotContent = (
      contentSid: string,
      options: { variables?: Record<string, string>; logLabel?: string } = {}
    ) => sendContentMessage(client, fromNumber, phoneNumber, contentSid, options);

    const showCategoryItems = async (category: MenuCategory) => {
      updateOrderState(phoneNumber, { activeCategoryId: category.id });

      let items: MenuItem[] = [];
      try {
        items = await getCategoryItems(merchantId, category.id);
      } catch (error) {
        console.error('❌ Failed to fetch category items from Sufrah API:', error);
        await sendBotText('⚠️ تعذر جلب الأصناف في الوقت الحالي، يرجى المحاولة لاحقاً.');
        return;
      }

      if (!items.length) {
        await sendBotText('⚠️ لا توجد أصناف متاحة ضمن هذه الفئة حالياً.');
        return;
      }

      try {
        const contentSid = await getCachedContentSid(
          `items_list:${merchantId}:${category.id}`,
          () => createItemsListPicker(TWILIO_CONTENT_AUTH, category.id, category.item, items),
          `اختر طبقاً من ${category.item}:`
        );
        await sendBotContent(contentSid, {
          variables: { '1': category.item },
          logLabel: `Items list picker for ${category.id} sent`,
        });
      } catch (error) {
        console.error('❌ Error creating/sending items list picker:', error);
        const itemsText = `🍽️ اختر طبقاً من ${category.item}:\n\n${items
          .map(
            (it, index) =>
              `${index + 1}. ${it.item}${it.description ? ` — ${it.description}` : ''} (${it.price} ${it.currency || 'ر.س'})`
          )
          .join('\n')}\n\nاكتب رقم الطبق أو اسمه.`;
        await sendBotText(itemsText);
      }
    };

    const handleItemSelection = async (picked: MenuItem) => {
      updateOrderState(phoneNumber, { activeCategoryId: picked.categoryId });

      setPendingItem(
        phoneNumber,
        {
          id: picked.id,
          name: picked.item,
          price: picked.price,
          currency: picked.currency,
          image: picked.image,
        },
        1
      );

      await sendItemMediaMessage(
        fromNumber,
        phoneNumber,
        `✅ تم اختيار ${picked.item} (${picked.price} ${picked.currency || 'ر.س'})`,
        picked.image
      );

      try {
        const quantitySid = await getCachedContentSid('quantity_prompt', () =>
          createQuantityQuickReply(TWILIO_CONTENT_AUTH, picked.item, 1)
        );
        await sendBotContent(quantitySid, {
          variables: { 1: picked.item, 2: '1' },
          logLabel: 'Quantity quick reply sent',
        });
      } catch (error) {
        console.error('❌ Error creating/sending quantity quick reply:', error);
        await sendBotText(`كم ترغب من ${picked.item}؟ اكتب العدد المطلوب (1-${MAX_ITEM_QUANTITY}).`);
      }
    };

    // Step 1: If first time, send welcome
    if (!welcomedUsers.has(phoneNumber)) {
      await sendWelcomeTemplate(
        phoneNumber,
        profileName,
        restaurantContext?.name ?? currentState.restaurant?.name ?? undefined
      );
      welcomedUsers.add(phoneNumber);
      console.log(`📱 Welcome message sent to new user: ${phoneNumber}`);
      return;
    }

    if (currentState.awaitingOrderReference && trimmedBody) {
      updateOrderState(phoneNumber, {
        awaitingOrderReference: false,
        lastQueriedReference: trimmedBody,
      });

      await sendBotText(`شكرًا لك! سنبحث عن حالة الطلب رقم ${trimmedBody} ونوافيك بالتحديث قريبًا.`
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
        await sendBotText('تعذر قراءة الموقع. فضلاً أعد مشاركة موقعك مرة أخرى.');
        updateOrderState(phoneNumber, { awaitingLocation: true });
        return;
      }

      updateOrderState(phoneNumber, {
        locationAddress: address,
        latitude: latitude || undefined,
        longitude: longitude || undefined,
        awaitingLocation: false,
      });

      await sendBotText(`✅ شكراً لك! تم استلام موقعك: ${address}.\nتصفّح القائمة لمتابعة الطلب.`);

      const updatedState = getOrderState(phoneNumber);
      if (updatedState.type === 'delivery') {
        await sendMenuCategories(fromNumber, phoneNumber, merchantId);
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
          await sendBotText('تم إلغاء عملية الحذف. هل ترغب في شيء آخر؟');
          return;
        }

        if (!cart.length) {
          updateOrderState(phoneNumber, { awaitingRemoval: false });
          await sendBotText('السلة فارغة حالياً، لا توجد أصناف لحذفها.');
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
          await sendBotText('تعذر العثور على هذا الصنف في السلة. اكتب الاسم كما يظهر في السلة أو أرسل "إلغاء" للخروج.');
          return;
        }

        removeItemFromCart(phoneNumber, targetItem.id);
        await syncSessionWithCart(conversationId, phoneNumber);
        updateOrderState(phoneNumber, { awaitingRemoval: false });

        await sendBotText(`تم حذف ${targetItem.name} من السلة.`);

        const updatedCart = getCart(phoneNumber);
        if (!updatedCart.length) {
          await sendBotText("أصبحت السلة فارغة الآن. اكتب 'طلب جديد' لإضافة أصناف.");
          return;
        }

        const updatedCartText = formatCartMessage(updatedCart);
        await sendBotText(updatedCartText);

        try {
          const optionsSid = await getCachedContentSid(
            'cart_options',
            () => createCartOptionsQuickReply(TWILIO_CONTENT_AUTH),
            'هذه تفاصيل سلتك، ماذا تود أن تفعل؟'
          );
          await sendBotContent(optionsSid, {
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
      await sendBotText('📍 لمشاركة موقعك: اضغط على رمز المشبك 📎 ثم اختر (الموقع) وأرسله.');
      updateOrderState(phoneNumber, { awaitingLocation: true });
      return;
    }

    if (trimmedBody === 'track_order' || normalizedBody.includes('track order') || normalizedBody.includes('تتبع')) {
      const state = getOrderState(phoneNumber);
      const cart = getCart(phoneNumber);
      const session = await getConversationSession(conversationId);
      const lastOrderNumber = session?.lastOrderNumber;

      if (!lastOrderNumber && !state.paymentMethod && !cart.length) {
        updateOrderState(phoneNumber, { awaitingOrderReference: true });
        await sendBotText('من فضلك أرسل رقم الطلب الذي ترغب في تتبعه (مثال: 6295).');
        return;
      }

      const referenceLine = lastOrderNumber
        ? `رقم الطلب: ${lastOrderNumber}`
        : state.orderReference
          ? `رقم الطلب: ${state.orderReference}`
          : 'رقم الطلب غير متوفر بعد.';
      const statusLine = state.lastStatusMessage
        ? state.lastStatusMessage
        : '🕒 طلبك قيد المراجعة.';
      const deliveryLine = state.type === 'delivery'
        ? state.locationAddress
          ? `سيتم التوصيل إلى: ${state.locationAddress}`
          : 'الموقع قيد التحديد.'
        : state.branchName
          ? `الاستلام من: ${state.branchName} (${state.branchAddress || 'سيتم التأكيد عند الوصول'})`
          : 'الاستلام من الفرع (سيتم تحديد الفرع).';

      await sendBotText(`${referenceLine}\n${statusLine}\n${deliveryLine}`);
      return;
    }

    if (trimmedBody === 'contact_support' ||
        normalizedBody.includes('contact support') ||
        normalizedBody.includes('support') ||
        normalizedBody.includes('دعم')) {
      await sendBotText(`☎️ للتواصل مع فريق الدعم يرجى الاتصال على ${SUPPORT_CONTACT} أو الرد هنا وسيقوم أحد موظفينا بمساعدتك.`);
      return;
    }

    const isNewOrderTrigger =
      trimmedBody === 'new_order' ||
      trimmedBody.includes('🆕') ||
      normalizedBody.includes('طلب جديد') ||
      normalizedBody.includes('new order');

    if (isNewOrderTrigger) {
      stopOrderStatusSimulation(phoneNumber);
      resetOrder(phoneNumber, { preserveRestaurant: true });
      await clearConversationSession(conversationId);
      await updateConversationSession(conversationId, sessionBaseUpdate);
      try {
        const contentSid = await getCachedContentSid('order_type', () =>
          createOrderTypeQuickReply(TWILIO_CONTENT_AUTH)
        );
        await sendBotContent(contentSid, {
          logLabel: 'Order type quick reply sent'
        });
      } catch (error) {
        console.error('❌ Error sending order type quick reply:', error);
        await sendBotText('يرجى الرد بكلمة (توصيل) أو (استلام) للمتابعة.');
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
      await sendMenuCategories(fromNumber, phoneNumber, merchantId);
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
      await updateConversationSession(conversationId, { selectedBranch: undefined });
      await syncSessionWithCart(conversationId, phoneNumber, {
        branchPhone: undefined,
        branchId: undefined,
        branchName: undefined,
      });
      try {
        const quickSid = await getCachedContentSid('location_request', () =>
          createLocationRequestQuickReply(TWILIO_CONTENT_AUTH)
        );
        await sendBotContent(quickSid, {
          logLabel: 'Location request quick reply sent'
        });
      } catch (error) {
        console.error('❌ Error sending location request:', error);
        await sendBotText('📍 لمشاركة موقعك: اضغط على رمز المشبك 📎 ثم اختر (الموقع) وأرسله.');
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
      await updateConversationSession(conversationId, { selectedBranch: undefined });
      await syncSessionWithCart(conversationId, phoneNumber, {
        branchPhone: undefined,
        branchId: undefined,
        branchName: undefined,
      });
      await sendBranchSelection(fromNumber, phoneNumber, merchantId);
      return;
    }

    if (trimmedBody.startsWith('branch_')) {
      const branchId = trimmedBody.replace(/^branch_/, '');
      const branch = await getBranchById(merchantId, branchId);
      if (!branch) {
        await sendBotText('تعذر العثور على هذا الفرع. يرجى اختيار فرع من القائمة.');
        await sendBranchSelection(fromNumber, phoneNumber, merchantId);
        return;
      }

      updateOrderState(phoneNumber, {
        type: 'pickup',
        branchId: branch.id,
        branchName: branch.item,
        branchAddress: branch.description,
      });

      const branchPhone = branch.raw?.phoneNumber
        ? standardizeWhatsappNumber(branch.raw.phoneNumber) || branch.raw.phoneNumber
        : undefined;

      await updateConversationSession(conversationId, {
        selectedBranch: {
          branchId: branch.raw?.id ?? branch.id,
          phoneNumber: branch.raw?.phoneNumber,
          nameEn: branch.raw?.nameEn ?? branch.item,
          nameAr: branch.raw?.nameAr,
          raw: branch.raw ?? branch,
        },
      });

      await syncSessionWithCart(conversationId, phoneNumber, {
        branchId: branch.raw?.id ?? branch.id,
        branchName: branch.item,
        branchPhone,
      });

      await sendBotText(`✅ تم اختيار ${branch.item}. العنوان: ${branch.description}.`);
      await sendMenuCategories(fromNumber, phoneNumber, merchantId);
      return;
    }

    if (
      currentState.type === 'pickup' &&
      !currentState.branchId &&
      trimmedBody &&
      !trimmedBody.startsWith('cat_') &&
      !trimmedBody.startsWith('item_')
    ) {
      const branch = await findBranchByText(merchantId, trimmedBody);
      if (branch) {
        updateOrderState(phoneNumber, {
          type: 'pickup',
          branchId: branch.id,
          branchName: branch.item,
          branchAddress: branch.description,
        });

        const branchPhone = branch.raw?.phoneNumber
          ? standardizeWhatsappNumber(branch.raw.phoneNumber) || branch.raw.phoneNumber
          : undefined;

        await updateConversationSession(conversationId, {
          selectedBranch: {
            branchId: branch.raw?.id ?? branch.id,
            phoneNumber: branch.raw?.phoneNumber,
            nameEn: branch.raw?.nameEn ?? branch.item,
            nameAr: branch.raw?.nameAr,
            raw: branch.raw ?? branch,
          },
        });

        await syncSessionWithCart(conversationId, phoneNumber, {
          branchId: branch.raw?.id ?? branch.id,
          branchName: branch.item,
          branchPhone,
        });

        await sendBotText(`✅ تم اختيار ${branch.item}. العنوان: ${branch.description}.`);
        await sendMenuCategories(fromNumber, phoneNumber, merchantId);
        return;
      }

      // If no branch matched, remind the user to select from the list
      await sendBotText('تعذر فهم اسم الفرع، يرجى اختيار فرع من القائمة أو كتابة اسمه كما هو.');
      await sendBranchSelection(fromNumber, phoneNumber, merchantId);
      return;
    }

    // Step 2.5: If user selected a category from the list picker → show items
    if (trimmedBody.startsWith('cat_')) {
      const categoryId = trimmedBody.replace(/^cat_/, '');
      const category = await getCategoryById(merchantId, categoryId);
      if (!category) {
        console.log(`⚠️ Unknown category id: ${categoryId}`);
        await sendBotText("عذراً، لم يتم العثور على هذه الفئة. اكتب 'طلب جديد' للبدء من جديد.");
        return;
      }
      await showCategoryItems(category);
      return;
    }

    if (!currentState.pendingItem && trimmedBody) {
      const categoryByText = await findCategoryByText(merchantId, trimmedBody);
      if (categoryByText) {
        await showCategoryItems(categoryByText);
        return;
      }
    }

    // Step 2.6: If user selected an item → add to cart, send image, then quick-replies
    if (trimmedBody.startsWith('item_')) {
      const itemId = trimmedBody.replace(/^item_/, '');
      const picked = await getItemById(merchantId, itemId);
      if (!picked) {
        await sendBotText("عذراً، لم يتم العثور على هذا الطبق. اكتب 'طلب جديد' للبدء من جديد.");
        return;
      }
      await handleItemSelection(picked);
      return;
    }

    if (!currentState.pendingItem && trimmedBody) {
      const activeCategoryId = currentState.activeCategoryId;
      const matchedItem = await findItemByText(merchantId, activeCategoryId, trimmedBody);
      if (matchedItem) {
        await handleItemSelection(matchedItem);
        return;
      }
    }

    if (
      trimmedBody === '🔢 كمية أخرى' ||
      normalizedBody.includes('كمية اخرى') ||
      normalizedBody.includes('كمية أخرى')
    ) {
      const pendingState = getOrderState(phoneNumber);
      if (pendingState.pendingItem) {
        await sendBotText(`من فضلك أرسل الكمية المطلوبة من ${pendingState.pendingItem.name} كرقم فقط (مثال: 4). المدى المسموح 1-${MAX_ITEM_QUANTITY}.`);
        updateOrderState(phoneNumber, {
          pendingQuantity: pendingState.pendingQuantity || 1,
        });
      } else {
        await sendBotText('فضلاً اختر طبقاً أولاً قبل تحديد الكمية.');
      }
      return;
    }

    const numericQuantity = parseInt(trimmedBody, 10);
    if (!Number.isNaN(numericQuantity) && numericQuantity > 0) {
      if (numericQuantity > MAX_ITEM_QUANTITY) {
        await sendBotText(`يمكنك طلب حتى ${MAX_ITEM_QUANTITY} حصص في كل مرة. الرجاء إرسال رقم ضمن النطاق.`);
        return;
      }

      const pendingState = getOrderState(phoneNumber);
      if (pendingState.pendingItem) {
        await finalizeItemQuantity(
          fromNumber,
          phoneNumber,
          conversationId,
          pendingState.pendingItem,
          numericQuantity
        );
        return;
      }

      if (pendingState.awaitingRemoval) {
        // fall through to removal handling below
      } else {
        await sendBotText('فضلاً اختر طبقاً أولاً قبل تحديد الكمية.');
        return;
      }
    }

    if (trimmedBody.startsWith('qty_')) {
      console.log(`🔍 DEBUG: Quantity selection detected: ${trimmedBody}`);
      console.log(`🔍 DEBUG: Current state:`, JSON.stringify(currentState, null, 2));
      
      const pendingItem = currentState.pendingItem;
      if (!pendingItem) {
        console.log(`❌ DEBUG: No pending item found for ${phoneNumber}`);
        await sendBotText('فضلاً اختر طبقاً من القائمة أولاً.');
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
          await sendBotText(`من فضلك أرسل الكمية المطلوبة من ${pendingItem.name} كرقم فقط (مثال: 4). المدى المسموح 1-${MAX_ITEM_QUANTITY}.`);
          updateOrderState(phoneNumber, { pendingQuantity: quantity });
          return;
        default:
          break;
      }

      console.log(`🔍 DEBUG: Final quantity: ${quantity}, calling finalizeItemQuantity`);
      await finalizeItemQuantity(fromNumber, phoneNumber, conversationId, pendingItem, quantity);
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
      await sendMenuCategories(fromNumber, phoneNumber, merchantId);
      return;
    }

    if (trimmedBody === 'view_cart' || normalizedBody.includes('view cart') || normalizedBody.includes('عرض السلة')) {
      const cart = getCart(phoneNumber);
      const cartText = formatCartMessage(cart);
      await sendBotText(cartText);

      if (!cart.length) {
        await sendBotText("سلتك فارغة. اكتب 'طلب جديد' لبدء طلب جديد."
        );
        return;
      }

      try {
        const optionsSid = await getCachedContentSid(
          'cart_options',
          () => createCartOptionsQuickReply(TWILIO_CONTENT_AUTH),
          'هذه تفاصيل سلتك، ماذا تود أن تفعل؟'
        );
        await sendBotContent(optionsSid, {
          logLabel: 'Cart options quick reply sent'
        });
      } catch (error) {
        console.error('❌ Error sending cart options:', error);
        await sendBotText("اكتب: إضافة لمتابعة التسوق، إزالة لحذف صنف، أو دفع لإتمام الطلب."
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
        await sendBotText("السلة فارغة، لا توجد أصناف للحذف."
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
        await sendBotContent(removeSid, {
          logLabel: 'Remove item list sent'
        });
      } catch (error) {
        console.error('❌ Error sending remove item list:', error);
        await sendBotText("اكتب اسم الصنف الذي ترغب في حذفه أو أرسل رقمه كما يظهر في السلة."
        );
      }
      return;
    }

    if (trimmedBody.startsWith('remove_item_')) {
      const itemId = trimmedBody.replace('remove_item_', '');
      const cart = getCart(phoneNumber);
      const entry = cart.find((item) => item.id === itemId);
      if (!entry) {
        await sendBotText("هذا الصنف غير موجود في السلة."
        );
        return;
      }

      removeItemFromCart(phoneNumber, itemId);
      await syncSessionWithCart(conversationId, phoneNumber);
      updateOrderState(phoneNumber, { awaitingRemoval: false });
      await sendBotText(`تم حذف ${entry.name} من السلة.`
      );

      const cartAfterRemoval = getCart(phoneNumber);
      if (!cartAfterRemoval.length) {
        await sendBotText("أصبحت السلة فارغة الآن. اكتب 'طلب جديد' لإضافة أصناف."
        );
        return;
      }

      const updatedCartText = formatCartMessage(cartAfterRemoval);
      await sendBotText(updatedCartText);

      try {
        const optionsSid = await getCachedContentSid(
          'cart_options',
          () => createCartOptionsQuickReply(TWILIO_CONTENT_AUTH),
          'هذه تفاصيل سلتك، ماذا تود أن تفعل؟'
        );
        await sendBotContent(optionsSid, {
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
        await sendBotText("سلتك فارغة، أضف أصنافاً قبل إتمام الطلب."
        );
        return;
      }

      const checkoutState = getOrderState(phoneNumber);
      if (checkoutState.type === 'delivery' && !checkoutState.locationAddress) {
        await sendBotText("فضلاً شارك موقع التوصيل أولاً حتى نتمكن من حساب رسوم التوصيل."
        );
        try {
          const locationSid = await getCachedContentSid('location_request', () =>
            createLocationRequestQuickReply(TWILIO_CONTENT_AUTH)
          );
          await sendBotContent(locationSid, {
            logLabel: 'Location request quick reply sent'
          });
        } catch (error) {
          console.error('❌ Error re-sending location request during checkout:', error);
        }
        return;
      }

      if (checkoutState.type === 'pickup' && !checkoutState.branchId) {
        await sendBotText('فضلاً اختر الفرع الذي تود الاستلام منه قبل إتمام الطلب.'
        );
        await sendBranchSelection(fromNumber, phoneNumber, merchantId);
        return;
      }

      await syncSessionWithCart(conversationId, phoneNumber);

      const summary = buildCartSummary(cart);
      const locationLine =
        checkoutState.type === 'delivery'
          ? checkoutState.locationAddress
            ? `التوصيل إلى: ${checkoutState.locationAddress}`
            : 'سيتم تحديد موقع التوصيل لاحقاً'
          : checkoutState.branchName
            ? `الاستلام من: ${checkoutState.branchName} (${checkoutState.branchAddress || 'سيتم التأكيد عند الوصول'})`
            : 'الاستلام من الفرع (سيتم تحديد الفرع لاحقاً).';

      const summaryText = [
        '🧾 ملخص الطلب:',
        ...summary.lines,
        '',
        `💰 الإجمالي: ${roundToTwo(summary.total)} ${summary.currency}`,
        locationLine,
        '',
        'اختر وسيلة الدفع:'
      ].join('\n');
      await sendBotText(summaryText);

      try {
        const paymentSid = await getCachedContentSid(
          'payment_options',
          () => createPaymentOptionsQuickReply(TWILIO_CONTENT_AUTH),
          'اختر وسيلة الدفع:'
        );
        await sendBotContent(paymentSid, {
          logLabel: 'Payment options quick reply sent'
        });
      } catch (error) {
        console.error('❌ Error sending payment options:', error);
        await sendBotText("اكتب (إلكتروني) أو (نقدي) لتحديد وسيلة الدفع."
        );
      }
      return;
    }

    if (trimmedBody === 'pay_online' || normalizedBody.includes('pay online') || trimmedBody === '💳 pay online' || normalizedBody.includes('دفع إلكتروني')) {
      updateOrderState(phoneNumber, { paymentMethod: 'online' });
      await syncSessionWithCart(conversationId, phoneNumber);

      const onlinePaymentState = getOrderState(phoneNumber);
      
      try {
        const orderNumber = await submitExternalOrder(conversationId, {
          twilioClient: client,
          customerPhone: phoneNumber,
          fromNumber,
        });

        console.log(`✅ Online order submitted to Sufrah with number ${orderNumber}`);

        stopOrderStatusSimulation(phoneNumber);
        resetOrder(phoneNumber, { preserveRestaurant: true });
        // Session preserved to track lastOrderNumber
      } catch (error) {
        if (error instanceof OrderSubmissionError) {
          if (error.code === 'NO_BRANCH_SELECTED') {
            await sendBotText('⚠️ يرجى اختيار الفرع قبل تأكيد الطلب.');
            if (onlinePaymentState.type === 'pickup') {
              await sendBranchSelection(fromNumber, phoneNumber, merchantId);
            }
            return;
          }
          if (error.code === 'API_ERROR') {
            await sendBotText('⚠️ تعذر إتمام الطلب حالياً، يرجى المحاولة مرة أخرى.');
            return;
          }
          if (error.code === 'INVALID_ITEMS') {
            await sendBotText('⚠️ لا يمكن إرسال الطلب لأن السلة فارغة أو غير مكتملة.');
            return;
          }
          if (error.code === 'CONFIG_MISSING') {
            await sendBotText('⚠️ إعدادات الربط الخارجي غير مكتملة. يرجى إبلاغ فريق الدعم.');
            return;
          }
          if (error.code === 'MERCHANT_NOT_CONFIGURED') {
            await sendBotText('⚠️ المتجر غير مكون بشكل صحيح. يرجى التواصل مع فريق الدعم.');
            return;
          }
          await sendBotText(`⚠️ ${error.message}`);
          return;
        }

        console.error('❌ Unexpected error submitting online order:', error);
        await sendBotText('⚠️ حدث خطأ أثناء إرسال الطلب. حاول لاحقاً.');
      }
      return;
    }

    if (trimmedBody === 'pay_cash' ||
        normalizedBody.includes('cash on delivery') ||
        normalizedBody.includes('cash') ||
        normalizedBody.includes('نقدي') ||
        normalizedArabic.includes('الدفع عند الاستلام')) {
      updateOrderState(phoneNumber, { paymentMethod: 'cash' });
      await syncSessionWithCart(conversationId, phoneNumber);

      const paymentState = getOrderState(phoneNumber);
      const fulfillmentLine = paymentState.type === 'pickup'
        ? paymentState.branchName
          ? `رجاء استلام طلبك من ${paymentState.branchName} (العنوان: ${paymentState.branchAddress || 'سيتم التأكيد عند الوصول'}).`
          : 'سننتظرك في الفرع المحدد لاستلام طلبك.'
        : paymentState.locationAddress
          ? `سيتم تحصيل المبلغ عند التسليم إلى العنوان: ${paymentState.locationAddress}.`
          : 'سيتم التواصل معك لتأكيد عنوان التوصيل قبل التسليم.';

      try {
        const orderNumber = await submitExternalOrder(conversationId, {
          twilioClient: client,
          customerPhone: phoneNumber,
          fromNumber,
        });

        await sendBotText(`✔️ تم اختيار الدفع نقداً عند الاستلام. ${fulfillmentLine}`);
        await sendBotText(`✅ تم تسجيل طلبك رقم #${orderNumber} وسيتم البدء بتحضيره.`);

        stopOrderStatusSimulation(phoneNumber);
        resetOrder(phoneNumber, { preserveRestaurant: true });
        // نحتفظ بجلسة المحادثة لعرض lastOrderNumber لاحقاً
      } catch (error) {
        if (error instanceof OrderSubmissionError) {
          if (error.code === 'NO_BRANCH_SELECTED') {
            await sendBotText('⚠️ يرجى اختيار الفرع قبل تأكيد الطلب.');
            if (paymentState.type === 'pickup') {
              await sendBranchSelection(fromNumber, phoneNumber, merchantId);
            }
            return;
          }
          if (error.code === 'API_ERROR') {
            await sendBotText('⚠️ تعذر إتمام الطلب حالياً، يرجى المحاولة مرة أخرى.');
            return;
          }
          if (error.code === 'INVALID_ITEMS') {
            await sendBotText('⚠️ لا يمكن إرسال الطلب لأن السلة فارغة أو غير مكتملة.');
            return;
          }
          if (error.code === 'MISSING_ORDER_TYPE') {
            await sendBotText('⚠️ يرجى تحديد نوع الطلب (توصيل أو استلام) قبل المتابعة.');
            return;
          }
          if (error.code === 'MISSING_PAYMENT_METHOD') {
            await sendBotText('⚠️ فضلاً اختر وسيلة الدفع قبل المتابعة.');
            return;
          }
          if (error.code === 'MERCHANT_NOT_CONFIGURED' || error.code === 'CONFIG_MISSING') {
            await sendBotText('⚠️ حدث خطأ في الإعدادات. يرجى إبلاغ فريق الدعم.');
            return;
          }
        }

        console.error('❌ Unexpected error submitting cash order:', error);
        await sendBotText('⚠️ حدث خطأ أثناء إرسال الطلب. حاول لاحقاً.');
      }
      return;
    }

    const isConfirmationTrigger =
      trimmedBody === 'confirm' ||
      trimmedBody === 'confirm_order' ||
      trimmedBody === '✅ تأكيد الطلب' ||
      normalizedBody.includes('confirm order') ||
      normalizedBody === 'confirm' ||
      normalizedArabic.includes('تاكيد') ||
      normalizedArabic.includes('تأكيد');

    if (isConfirmationTrigger) {
      try {
        await syncSessionWithCart(conversationId, phoneNumber);
        const orderNumber = await submitExternalOrder(conversationId, {
          twilioClient: client,
          customerPhone: phoneNumber,
          fromNumber,
        });

        console.log(`✅ Order submitted to Sufrah with number ${orderNumber}`);

        stopOrderStatusSimulation(phoneNumber);
        resetOrder(phoneNumber, { preserveRestaurant: true });
        // لا نقوم بمسح جلسة المحادثة للحفاظ على رقم الطلب الأخير في الجلسة للتتبع
        return;
      } catch (error) {
        if (error instanceof OrderSubmissionError) {
          if (error.code === 'NO_BRANCH_SELECTED') {
            await sendBotText('⚠️ يرجى اختيار الفرع قبل تأكيد الطلب.');
            return;
          }
          if (error.code === 'API_ERROR') {
            await sendBotText('⚠️ تعذر إتمام الطلب، يرجى المحاولة مرة أخرى.');
            return;
          }
          if (error.code === 'ORDER_NOT_FOUND') {
            await sendBotText('⚠️ لم يتم العثور على طلب نشط لتأكيده. ابدأ طلباً جديداً من فضلك.');
            return;
          }
          if (error.code === 'MERCHANT_NOT_CONFIGURED') {
            await sendBotText('⚠️ تعذر العثور على بيانات المطعم. تواصل مع الدعم للمساعدة.');
            return;
          }
          if (error.code === 'INVALID_ITEMS') {
            await sendBotText('⚠️ لا يمكن إرسال الطلب لأن السلة فارغة أو غير مكتملة.');
            return;
          }
          if (error.code === 'CONFIG_MISSING') {
            await sendBotText('⚠️ إعدادات الربط الخارجي غير مكتملة. يرجى إبلاغ فريق الدعم.');
            return;
          }
          if (error.code === 'MISSING_PAYMENT_METHOD') {
            await sendBotText('⚠️ فضلاً اختر وسيلة الدفع (إلكتروني أو نقدي) قبل تأكيد الطلب.');
            return;
          }
          if (error.code === 'MISSING_ORDER_TYPE') {
            await sendBotText('⚠️ يرجى تحديد نوع الطلب (توصيل أو استلام) قبل المتابعة.');
            return;
          }
          if (error.code === 'CUSTOMER_INFO_MISSING') {
            await sendBotText('⚠️ نحتاج إلى رقم هاتف صالح لإكمال الطلب. حاول مرة أخرى أو تواصل مع الدعم.');
            return;
          }
        }

        console.error('❌ Unexpected error submitting external order:', error);
        await sendBotText('⚠️ حدث خطأ أثناء تأكيد الطلب. حاول لاحقاً أو تواصل مع الدعم.');
        return;
      }
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
          // Use sendNotification to handle 24h window automatically for manual dashboard messages
          await sendNotification(normalizedId, messageText, { fromNumber: TWILIO_WHATSAPP_FROM });
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

    if (req.method === 'POST' && url.pathname === '/api/whatsapp/send') {
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

      const body = (await req.json().catch(() => ({}))) as {
        phoneNumber?: unknown;
        text?: unknown;
        templateVariables?: unknown;
      };

      const rawPhone = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : '';
      const messageText = typeof body.text === 'string' ? body.text.trim() : '';
      const templateVariables = body && typeof body === 'object' && body !== null && typeof (body as any).templateVariables === 'object' && (body as any).templateVariables !== null
        ? (body as any).templateVariables as Record<string, any>
        : undefined;

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

      try {
        const result = await sendNotification(standardizedPhone, messageText, {
          fromNumber: TWILIO_WHATSAPP_FROM,
          templateVariables,
        });

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
    
    // WhatsApp multi-tenant webhook (Twilio)
    if (req.method === 'POST' && url.pathname === '/whatsapp/webhook') {
      try {
        const contentType = req.headers.get('content-type') || '';
        if (!contentType.includes('application/x-www-form-urlencoded')) {
          return new Response('Unsupported Media Type', { status: 415 });
        }

        const raw = await req.text();
        const params = new URLSearchParams(raw);
        const payload = Object.fromEntries(params.entries());

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
        console.error('❌ Error in /whatsapp/webhook:', error);
        return new Response('Internal Server Error', { status: 500 });
      }
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
          const to = params.get('To') || '';
          const bodyText = params.get('Body') || '';
          const profileName = params.get('ProfileName') || '';
          const buttonPayload = params.get('ButtonPayload') || '';
          const buttonText = params.get('ButtonText') || '';
          
          // Check if this is a "View Order Details" button click
          const isViewOrderRequest = 
            buttonPayload === 'view_order' || 
            bodyText === 'View Order Details' ||
            buttonText === 'View Order Details';
            
          if (isViewOrderRequest) {
            console.log(`🔘 [ButtonClick] User requested "View Order Details" from ${from}`);
            
            // Persist button click to database for 24h window tracking
            try {
              const restaurantContext = await resolveRestaurantContext(from, to);
              if (restaurantContext) {
                const normalizedCustomer = normalizePhoneNumber(from);
                const normalizedRecipient = normalizePhoneNumber(to);
                const dbConversation = await findOrCreateDbConversation(
                  restaurantContext.id,
                  normalizedCustomer,
                  profileName
                );
                
                // Create inbound message record for button click
                await createInboundMessage({
                  conversationId: dbConversation.id,
                  restaurantId: restaurantContext.id,
                  waSid: `button_${Date.now()}_${from}`, // Synthetic ID for button clicks
                  fromPhone: normalizedCustomer,
                  toPhone: normalizedRecipient,
                  messageType: 'button',
                  content: buttonText || 'View Order Details',
                  metadata: { buttonPayload, buttonText, isButtonResponse: true },
                });
                
                await updateDbConversation(dbConversation.id, {
                  lastMessageAt: new Date(),
                });
                
                console.log(`✅ [ButtonClick] Persisted button click to database for ${from}`);
              }
            } catch (persistErr) {
              console.warn('⚠️ [ButtonClick] Failed to persist button click to database (continuing):', persistErr);
            }
            
            // Retrieve cached message (and mark as delivered)
            const cachedMessage = await consumeCachedMessageForPhone(from);
            
            if (cachedMessage) {
              console.log(`📤 [ButtonClick] Sending cached order details to ${from} (freeform - button opened 24h window)`);
              
              try {
                // Button click opens 24h window - send as freeform message directly
                await sendNotification(from, cachedMessage, { fromNumber: to, forceFreeform: true });
                
                console.log(`✅ [ButtonClick] Successfully sent cached message to ${from}`);
                return new Response(null, { status: 200 });
              } catch (error) {
                console.error(`❌ [ButtonClick] Failed to send cached message to ${from}:`, error);
                return new Response(null, { status: 500 });
              }
            } else {
              console.warn(`⚠️ [ButtonClick] No cached message found for ${from}`);
              
              // Send a fallback message directly (button click opened 24h window)
              try {
                await sendNotification(from, 'Sorry, order details are no longer available. Please contact support.', { fromNumber: to, forceFreeform: true });
              } catch (error) {
                console.error(`❌ [ButtonClick] Failed to send fallback message:`, error);
              }
              
              return new Response(null, { status: 200 });
            }
          }
          
          // Check if this is any other button click - skip bot processing
          if (buttonPayload || buttonText) {
            console.log(`🔘 [OldWebhook] Button click detected, skipping bot processing: ${buttonPayload || buttonText}`);
            return new Response(null, { status: 200 });
          }
          
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
            if (to) {
              locationExtra.recipientPhone = to;
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
            if (to) {
              textExtra.recipientPhone = to;
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
                          
                          // Check if this is "View Order Details" button
                          const isViewOrderRequest = 
                            messageBody === 'view_order' || 
                            buttonText === 'View Order Details';
                            
                          if (isViewOrderRequest) {
                            console.log(`🔘 [Meta ButtonClick] User requested "View Order Details" from ${phoneNumber}`);
                            
                            // Persist button click to database for 24h window tracking
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
                                
                                // Create inbound message record for button click
                                await createInboundMessage({
                                  conversationId: dbConversation.id,
                                  restaurantId: restaurantContext.id,
                                  waSid: `button_${Date.now()}_${phoneNumber}`, // Synthetic ID for button clicks
                                  fromPhone: normalizedCustomer,
                                  toPhone: normalizedRecipient,
                                  messageType: 'button',
                                  content: buttonText || 'View Order Details',
                                  metadata: { buttonPayload: messageBody, buttonText, isButtonResponse: true },
                                });
                                
                                await updateDbConversation(dbConversation.id, {
                                  lastMessageAt: new Date(),
                                });
                                
                                console.log(`✅ [Meta ButtonClick] Persisted button click to database for ${phoneNumber}`);
                              }
                            } catch (persistErr) {
                              console.warn('⚠️ [Meta ButtonClick] Failed to persist button click to database (continuing):', persistErr);
                            }
                            
                            // Retrieve cached message (and mark as delivered)
                            const cachedMessage = await consumeCachedMessageForPhone(phoneNumber);
                            
                            if (cachedMessage) {
                              console.log(`📤 [Meta ButtonClick] Sending cached order details to ${phoneNumber} (freeform - button opened 24h window)`);
                              
                              try {
                                // Button click opens 24h window - send as freeform message directly
                                await sendNotification(phoneNumber, cachedMessage, { fromNumber: recipientPhone || TWILIO_WHATSAPP_FROM, forceFreeform: true });
                                console.log(`✅ [Meta ButtonClick] Successfully sent cached message to ${phoneNumber}`);
                              } catch (error) {
                                console.error(`❌ [Meta ButtonClick] Failed to send cached message to ${phoneNumber}:`, error);
                              }
                            } else {
                              console.warn(`⚠️ [Meta ButtonClick] No cached message found for ${phoneNumber}`);
                              
                              // Send a fallback message directly (button click opened 24h window)
                              try {
                                await sendNotification(phoneNumber, 'Sorry, order details are no longer available. Please contact support.', { fromNumber: recipientPhone || TWILIO_WHATSAPP_FROM, forceFreeform: true });
                              } catch (error) {
                                console.error(`❌ [Meta ButtonClick] Failed to send fallback message:`, error);
                              }
                            }
                            return; // Don't process as normal message
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
