import twilio from 'twilio';
import { sendContentMessage, sendTextMessage } from '../twilio/messaging';
import { createContent } from '../twilio/content';
import { ensureWhatsAppAddress, normalizePhoneNumber, standardizeWhatsappNumber } from '../utils/phone';
import { buildCategoriesFallback, matchesAnyTrigger } from '../utils/text';
import { getReadableAddress } from '../utils/geocode';
import { TWILIO_CONTENT_AUTH, SUPPORT_CONTACT } from '../config';
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
} from '../workflows/menuData';
import { getRestaurantByWhatsapp, type SufrahRestaurant } from '../db/sufrahRestaurantService';
import { findRestaurantByWhatsAppNumber } from '../db/restaurantService';
import { prisma } from '../db/client';
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
} from '../workflows/quickReplies';
import { getCachedContentSid, seedCacheFromKey } from '../workflows/cache';
import { recordInboundMessage } from '../workflows/messages';
import { registerTemplateTextForSid } from '../workflows/templateText';
import { submitExternalOrder, OrderSubmissionError } from '../services/orderSubmission';
import { TwilioClientManager } from '../twilio/clientManager';
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
  generateOrderReference,
} from '../state/orders';
import { type CartItem, type OrderType, type CartAddon } from '../types';
import {
  clearConversationSession,
  getConversationSession,
  updateConversationSession,
  type ConversationSession,
  type SessionOrderItem,
} from '../state/session';
import { getGlobalBotEnabled, hasWelcomed, markWelcomed } from '../state/bot';
import { stopOrderStatusSimulation, startOrderStatusSimulation } from './orderStatus';

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
    addons: (item.addons ?? []).map((addon: CartAddon) => ({
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
    const addonLines = (item.addons ?? []).map((addon: CartAddon) => {
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

// Send welcome template
export async function sendWelcomeTemplate(
  to: string,
  profileName?: string,
  restaurant?: SufrahRestaurant
) {
  const safeRestaurantName = restaurant?.name?.trim() || process.env.RESTAURANT_NAME || 'مطعم XYZ';
  const safeGuestName = profileName || 'ضيفنا الكريم';
  
  try {
    if (!restaurant) throw new Error("Restaurant context is required");

    const twilioClientManager = new TwilioClientManager();
    const twilioClient = await twilioClientManager.getClient(restaurant.id);
    if (!twilioClient) throw new Error("Twilio client is not available for this restaurant");

    // Special welcome message for Ocean Restaurant
    const OCEAN_MERCHANT_ID = '2a065243-3b03-41b9-806b-571cfea27ea8';
    if (restaurant.externalMerchantId === OCEAN_MERCHANT_ID) {
      const oceanWelcome = `مرحباً بكم في مطعم شاورما أوشن 🌊

استمتعوا بعرضنا الخاص عند الطلب من التطبيق فقط:
✨ خصم 10% على طلبك
🚗 توصيل مجاني لجميع الطلبات

احصل على عرضك الآن من خلال تحميل التطبيق:

📱 لأجهزة iPhone:
https://apps.apple.com/us/app/%D8%B4%D8%A7%D9%88%D8%B1%D9%85%D8%A7-%D8%A3%D9%88%D8%B4%D9%86/id6753905053?platform=iphone

📱 لأجهزة Android:
https://play.google.com/store/apps/details?id=com.sufrah.shawarma_ocean_app&pcampaignid=web_share

اطلب الآن واستمتع بأفضل تجربة شاورما 🍔😋`;

      await sendTextMessage(twilioClient, restaurant.whatsappNumber || process.env.TWILIO_WHATSAPP_FROM || '', to, oceanWelcome);
      console.log(`✅ Ocean Restaurant custom welcome sent to ${to}`);
      return;
    }

    let welcomeContentSid = process.env.CONTENT_SID_WELCOME || '';
    let welcomeApprovalRequested = !!welcomeContentSid;

    if (!welcomeContentSid) {
      const created = await twilioClient.content.v1.contents.create({
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

    return sendContentMessage(twilioClient, restaurant.whatsappNumber || process.env.TWILIO_WHATSAPP_FROM || '', to, welcomeContentSid, {
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
    if (restaurant) {
      const twilioClientManager = new TwilioClientManager();
      const twilioClient = await twilioClientManager.getClient(restaurant.id);
      if (twilioClient) {
        return sendTextMessage(twilioClient, restaurant.whatsappNumber || process.env.TWILIO_WHATSAPP_FROM || '', to, fallback);
      }
    }
  }
}

export async function sendItemMediaMessage(
  client: twilio.Twilio,
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

export async function finalizeItemQuantity(
  client: twilio.Twilio,
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
    (sum: number, addon: CartAddon) => sum + addon.price * addon.quantity,
    0
  );
  const lineTotal = roundToTwo(pendingItem.price * quantity + addonsTotal);
  const additionText = `✅ تم إضافة ${quantity} × ${pendingItem.name} إلى السلة (الإجمالي ${lineTotal} ${currency})`;
  
  console.log(`🔍 DEBUG: Sending confirmation message to ${phoneNumber}: "${additionText}"`);
  
  if (pendingItem.image) {
    console.log(`🔍 DEBUG: Sending media message with image for ${phoneNumber}`);
    await sendItemMediaMessage(client, fromNumber, phoneNumber, additionText, pendingItem.image);
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

export async function sendMenuCategories(
  client: twilio.Twilio,
  fromNumber: string,
  phoneNumber: string,
  merchantId: string
) {
  const MAX_LIST_PICKER_ITEMS = 10;
  
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
    // Split categories into chunks of 10
    const totalPages = Math.ceil(categories.length / MAX_LIST_PICKER_ITEMS);
    
    for (let page = 1; page <= totalPages; page++) {
      const startIdx = (page - 1) * MAX_LIST_PICKER_ITEMS;
      const endIdx = startIdx + MAX_LIST_PICKER_ITEMS;
      const pageCategories = categories.slice(startIdx, endIdx);
      
      const cacheKey = `categories:${merchantId}:p${page}`;
      const contentSid = await getCachedContentSid(
        cacheKey,
        () => createFoodListPicker(TWILIO_CONTENT_AUTH, pageCategories, page),
        'تصفح قائمتنا:'
      );
      await sendContentMessage(client, fromNumber, phoneNumber, contentSid, {
        variables: { "1": "اليوم" },
        logLabel: `Categories list picker sent (page ${page}/${totalPages})`
      });
      
      // Small delay between messages to ensure proper order
      if (page < totalPages) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
  } catch (error) {
    console.error('❌ Error creating/sending dynamic list picker:', error);
    const categoriesText = buildCategoriesFallback(categories);
    await sendTextMessage(client, fromNumber, phoneNumber, categoriesText);
  }
}

export async function sendBranchSelection(
  client: twilio.Twilio,
  fromNumber: string,
  phoneNumber: string,
  merchantId: string
) {
  const MAX_LIST_PICKER_ITEMS = 10;
  
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
    // Split branches into chunks of 10
    const totalPages = Math.ceil(branches.length / MAX_LIST_PICKER_ITEMS);
    
    for (let page = 1; page <= totalPages; page++) {
      const startIdx = (page - 1) * MAX_LIST_PICKER_ITEMS;
      const endIdx = startIdx + MAX_LIST_PICKER_ITEMS;
      const pageBranches = branches.slice(startIdx, endIdx);
      
      const cacheKey = `branch_list:${merchantId}:p${page}`;
      const branchSid = await getCachedContentSid(
        cacheKey,
        () => createBranchListPicker(TWILIO_CONTENT_AUTH, pageBranches, page),
        'اختر الفرع الأقرب لك:'
      );
      await sendContentMessage(client, fromNumber, phoneNumber, branchSid, {
        logLabel: `Branch list picker sent (page ${page}/${totalPages})`
      });
      
      // Small delay between messages to ensure proper order
      if (page < totalPages) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
  } catch (error) {
    console.error('❌ Error creating/sending branch list picker:', error);
    const fallback = `🏢 اختر الفرع الأقرب لك:\n\n${branches
      .map((branch, index) => `${index + 1}. ${branch.item} — ${branch.description}`)
      .join('\n')}\n\nاكتب اسم الفرع أو رقمه.`;
    await sendTextMessage(client, fromNumber, phoneNumber, fallback);
  }
}

export async function resolveRestaurantContext(
  phoneNumber: string,
  recipientPhone?: string
): Promise<SufrahRestaurant | null> {
  const state = getOrderState(phoneNumber);
  const fallbackRecipient =
    recipientPhone || state.restaurant?.whatsappNumber || process.env.TWILIO_WHATSAPP_FROM || '';
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
    // Step 1: Find the bot linked to this WhatsApp number
    const bot = await findRestaurantByWhatsAppNumber(standardizedRecipient);
    
    if (bot && bot.restaurantId) {
      // Step 2: Get the RestaurantProfile for this bot
      const restaurantProfile = await (prisma as any).restaurant?.findUnique?.({
        where: { id: bot.restaurantId },
        select: {
          id: true,
          name: true,
          externalMerchantId: true,
        },
      });

      if (restaurantProfile && restaurantProfile.externalMerchantId) {
        console.log(`ℹ️ Resolved restaurant context from bot ${bot.id} → profile ${bot.restaurantId} → merchant ${restaurantProfile.externalMerchantId}`);
        const restaurantContext: SufrahRestaurant = {
          id: restaurantProfile.id,
          name: restaurantProfile.name || bot.restaurantName || bot.name || null,
          whatsappNumber: standardizeWhatsappNumber(bot.whatsappNumber),
          externalMerchantId: restaurantProfile.externalMerchantId,
        };

        updateOrderState(phoneNumber, { restaurant: restaurantContext });
        return restaurantContext;
      }

      // Fallback: No externalMerchantId, create synthetic context
      console.log(`ℹ️ Creating synthetic restaurant context from bot ${bot.id} for tenant ${bot.restaurantId} (no Sufrah merchant ID)`);
      const syntheticRestaurant: SufrahRestaurant = {
        id: bot.restaurantId,
        name: bot.restaurantName || bot.name || null,
        whatsappNumber: standardizeWhatsappNumber(bot.whatsappNumber),
        externalMerchantId: bot.restaurantId, // Use restaurantId as synthetic merchantId
      };

      updateOrderState(phoneNumber, { restaurant: syntheticRestaurant });
      return syntheticRestaurant;
    }

    // Step 3: Legacy fallback - direct WhatsApp number lookup (for old setups)
    const restaurant = await getRestaurantByWhatsapp(standardizedRecipient);
    if (restaurant) {
      const normalizedRestaurant: SufrahRestaurant = {
        ...restaurant,
        whatsappNumber: standardizeWhatsappNumber(restaurant.whatsappNumber),
      };

      updateOrderState(phoneNumber, { restaurant: normalizedRestaurant });
      return normalizedRestaurant;
    }

    return null;
  } catch (error) {
    console.error('❌ Failed to resolve restaurant by WhatsApp number:', error);
    return null;
  }
}

// Main message processor - handles welcome and menu browsing
export async function processMessage(phoneNumber: string, messageBody: string, messageType: string = 'text', extra: any = {}): Promise<void> {
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
      process.env.TWILIO_WHATSAPP_FROM;

    const restaurantContext = await resolveRestaurantContext(phoneNumber, recipientPhoneRaw);
    const fallbackFrom = standardizeWhatsappNumber(recipientPhoneRaw || process.env.TWILIO_WHATSAPP_FROM || '') || process.env.TWILIO_WHATSAPP_FROM || '';
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
      botEnabled: getGlobalBotEnabled(),
    });

    if (!restaurantContext) {
      console.warn('⚠️ No restaurant context for message; skipping auto-reply');
      return;
    }

    const twilioClientManager = new TwilioClientManager();
    const twilioClient = await twilioClientManager.getClient(restaurantContext.id);
    if (!twilioClient) {
      console.error(`❌ No Twilio client for restaurant ${restaurantContext.id}`);
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
        twilioClient,
        fromNumber,
        phoneNumber,
        '⚠️ الخدمة غير متاحة مؤقتاً، يرجى المحاولة لاحقاً.'
      );
      return;
    }

    // Check if merchantId is a real Sufrah merchant ID (UUID format) or synthetic (CUID)
    const isSyntheticMerchant = merchantId && merchantId.startsWith('c') && merchantId.length > 20;
    if (isSyntheticMerchant) {
      console.log(`ℹ️ Synthetic merchant ID detected (${merchantId}). Sufrah integration not available for this tenant.`);
      
      // Send welcome for first-time users even without Sufrah
      if (!hasWelcomed(phoneNumber)) {
        await sendTextMessage(
          twilioClient,
          fromNumber,
          phoneNumber,
          `مرحباً بك في ${restaurantContext.name || 'مطعمنا'}! 👋\n\nنحن هنا لخدمتك. يمكنك التواصل معنا مباشرة وسيقوم فريقنا بالرد عليك في أقرب وقت.\n\nشكراً لتواصلك معنا! 🌟`
        );
        markWelcomed(phoneNumber);
      }
      return;
    }

    if (!getGlobalBotEnabled()) {
      console.log(`🤖 Bot disabled globally. Skipping automated handling for ${phoneNumber}.`);
      return;
    }

    const sendBotText = (text: string) =>
      sendTextMessage(twilioClient, fromNumber, phoneNumber, text);
    const sendBotContent = (
      contentSid: string,
      options: { variables?: Record<string, string>; logLabel?: string } = {}
    ) => sendContentMessage(twilioClient, fromNumber, phoneNumber, contentSid, options);

    const showCategoryItems = async (category: MenuCategory) => {
      const MAX_LIST_PICKER_ITEMS = 10;
      
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
        // Split items into chunks of 10
        const totalPages = Math.ceil(items.length / MAX_LIST_PICKER_ITEMS);
        
        for (let page = 1; page <= totalPages; page++) {
          const startIdx = (page - 1) * MAX_LIST_PICKER_ITEMS;
          const endIdx = startIdx + MAX_LIST_PICKER_ITEMS;
          const pageItems = items.slice(startIdx, endIdx);
          
          const contentSid = await getCachedContentSid(
            `items_list:${merchantId}:${category.id}:p${page}`,
            () => createItemsListPicker(TWILIO_CONTENT_AUTH, category.id, category.item, pageItems, page),
            `اختر طبقاً من ${category.item}:`
          );
          await sendBotContent(contentSid, {
            variables: { '1': category.item },
            logLabel: `Items list picker for ${category.id} sent (page ${page}/${totalPages})`,
          });
          
          // Small delay between messages to ensure proper order
          if (page < totalPages) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
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
        twilioClient,
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
    if (!hasWelcomed(phoneNumber)) {
      await sendWelcomeTemplate(
        phoneNumber,
        profileName,
        restaurantContext
      );
      markWelcomed(phoneNumber);
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
        address = await getReadableAddress(latitude, longitude, process.env.NOMINATIM_USER_AGENT || '');
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
        await sendMenuCategories(twilioClient, fromNumber, phoneNumber, merchantId);
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
      await sendMenuCategories(twilioClient, fromNumber, phoneNumber, merchantId);
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
      await sendBranchSelection(twilioClient, fromNumber, phoneNumber, merchantId);
      return;
    }

    if (trimmedBody.startsWith('branch_')) {
      const branchId = trimmedBody.replace(/^branch_/, '');
      const branch = await getBranchById(merchantId, branchId);
      if (!branch) {
        await sendBotText('تعذر العثور على هذا الفرع. يرجى اختيار فرع من القائمة.');
        await sendBranchSelection(twilioClient, fromNumber, phoneNumber, merchantId);
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
      await sendMenuCategories(twilioClient, fromNumber, phoneNumber, merchantId);
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
        await sendMenuCategories(twilioClient, fromNumber, phoneNumber, merchantId);
        return;
      }

      // If no branch matched, remind the user to select from the list
      await sendBotText('تعذر فهم اسم الفرع، يرجى اختيار فرع من القائمة أو كتابة اسمه كما هو.');
      await sendBranchSelection(twilioClient, fromNumber, phoneNumber, merchantId);
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
          twilioClient,
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
      await finalizeItemQuantity(twilioClient, fromNumber, phoneNumber, conversationId, pendingItem, quantity);
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
      await sendMenuCategories(twilioClient, fromNumber, phoneNumber, merchantId);
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
      const MAX_LIST_PICKER_ITEMS = 10;
      const cart = getCart(phoneNumber);
      if (!cart.length) {
        await sendBotText("السلة فارغة، لا توجد أصناف للحذف."
        );
        return;
      }

      updateOrderState(phoneNumber, { awaitingRemoval: true });

      try {
        const cartItems = cart.map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          currency: item.currency,
        }));
        
        // Split cart items into chunks of 10
        const totalPages = Math.ceil(cartItems.length / MAX_LIST_PICKER_ITEMS);
        
        for (let page = 1; page <= totalPages; page++) {
          const startIdx = (page - 1) * MAX_LIST_PICKER_ITEMS;
          const endIdx = startIdx + MAX_LIST_PICKER_ITEMS;
          const pageCartItems = cartItems.slice(startIdx, endIdx);
          
          const removeSid = await createRemoveItemListQuickReply(
            TWILIO_CONTENT_AUTH,
            pageCartItems,
            page
          );
          registerTemplateTextForSid(removeSid, 'اختر الصنف الذي ترغب في حذفه من السلة:');
          await sendBotContent(removeSid, {
            logLabel: `Remove item list sent (page ${page}/${totalPages})`
          });
          
          // Small delay between messages to ensure proper order
          if (page < totalPages) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
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
      await sendBranchSelection(twilioClient, fromNumber, phoneNumber, merchantId);
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
          twilioClient: twilioClient,
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
              await sendBranchSelection(twilioClient, fromNumber, phoneNumber, merchantId);
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
          twilioClient: twilioClient,
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
              await sendBranchSelection(twilioClient, fromNumber, phoneNumber, merchantId);
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
          twilioClient: twilioClient,
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
