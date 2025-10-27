import { createContent } from '../twilio/content';
import { MAX_ITEM_QUANTITY, type BranchOption, type MenuItem, type MenuCategory } from './menuData';

const MAX_LIST_PICKER_ITEMS = 10;
const MAX_ITEM_TITLE_LENGTH = 24; // Twilio's limit for list picker item titles
const MAX_DESCRIPTION_LENGTH = 72; // Twilio's limit for list picker item descriptions

interface FriendlyNameOptions {
  friendlyName?: string;
}

/**
 * Splits an array into chunks of specified size
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Truncates a string to a maximum length, adding ellipsis if needed
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Truncates item title to 24 characters (Twilio limit)
 */
function truncateItemTitle(text: string): string {
  return truncateText(text, MAX_ITEM_TITLE_LENGTH);
}

/**
 * Truncates description to 72 characters (Twilio limit)
 */
function truncateDescription(text: string): string {
  return truncateText(text, MAX_DESCRIPTION_LENGTH);
}

export async function createOrderTypeQuickReply(auth: string): Promise<string> {
  const payload = {
    friendly_name: `order_type_${Date.now()}`,
    language: 'ar',
    types: {
      'twilio/quick-reply': {
        body: 'اختر نوع الطلب:',
        actions: [
          { id: 'order_delivery', title: '🛵 توصيل', type: 'QUICK_REPLY' },
          { id: 'order_pickup', title: '🏠 استلام', type: 'QUICK_REPLY' },
        ],
      },
      'twilio/text': {
        body: 'يرجى الرد بكلمة (توصيل) أو (استلام).',
      },
    },
  } as any;

  return createContent(auth, payload, 'Order type quick reply created');
}

export async function createFoodListPicker(
  auth: string,
  categories: MenuCategory[],
  page: number = 1,
  options: FriendlyNameOptions = {}
): Promise<{ sid: string; friendlyName: string }> {
  const friendlyName = options.friendlyName ?? `food_list_${Date.now()}_p${page}`;
  const items = categories.map((category) => ({
    id: `cat_${category.id}`,
    item: truncateItemTitle(category.item),
    description: truncateDescription(category.description || ''),
  }));

  const totalPages = Math.ceil(items.length / MAX_LIST_PICKER_ITEMS);
  const pageIndicator = totalPages > 1 ? ` (صفحة ${page} من ${totalPages})` : '';

  const payload = {
    friendly_name: friendlyName,
    language: 'ar',
    variables: { '1': 'اليوم' },
    types: {
      'twilio/list-picker': {
        body: `تصفح قائمتنا${pageIndicator}:`,
        button: 'عرض الفئات',
        items,
      },
      'twilio/text': {
        body: `الفئات المتاحة${pageIndicator}: ${items.map((x) => x.item).join('، ')}`,
      },
    },
  };

  const sid = await createContent(auth, payload, `Dynamic list picker created (page ${page})`);
  return { sid, friendlyName };
}

export async function createBranchListPicker(
  auth: string,
  branches: BranchOption[],
  page: number = 1,
  options: FriendlyNameOptions = {}
): Promise<{ sid: string; friendlyName: string }> {
  const friendlyName = options.friendlyName ?? `branch_list_${Date.now()}_p${page}`;
  const pickerItems = branches.map((branch) => ({
    id: `branch_${branch.id}`,
    item: truncateItemTitle(branch.item),
    description: truncateDescription(branch.description || ''),
  }));

  const totalPages = Math.ceil(branches.length / MAX_LIST_PICKER_ITEMS);
  const pageIndicator = totalPages > 1 ? ` (صفحة ${page} من ${totalPages})` : '';

  const payload = {
    friendly_name: friendlyName,
    language: 'ar',
    types: {
      'twilio/list-picker': {
        body: `اختر الفرع الأقرب لك${pageIndicator}:`,
        button: 'عرض الفروع',
        items: pickerItems,
      },
      'twilio/text': {
        body: `الفروع المتاحة${pageIndicator}:\n${branches
          .map((branch, index) => `${index + 1}. ${branch.item} — ${branch.description}`)
          .join('\n')}`,
      },
    },
  } as any;

  const sid = await createContent(auth, payload, `Branch list picker created (page ${page})`);
  return { sid, friendlyName };
}

export async function createItemsListPicker(
  auth: string,
  categoryId: string,
  itemLabel: string,
  items: MenuItem[],
  page: number = 1,
  options: FriendlyNameOptions = {}
): Promise<{ sid: string; friendlyName: string }> {
  const friendlyName =
    options.friendlyName ?? `items_list_${categoryId}_${Date.now()}_p${page}`;
  const listItems = items.map((item) => {
    const priceText = `${item.price} ${item.currency || 'ر.س'}`;
    const fullDescription = item.description
      ? `${item.description} • ${priceText}`
      : priceText;
    
    return {
      id: `item_${item.id}`,
      item: truncateItemTitle(item.item),
      description: truncateDescription(fullDescription),
    };
  });

  const totalPages = Math.ceil(items.length / MAX_LIST_PICKER_ITEMS);
  const pageIndicator = totalPages > 1 ? ` (صفحة ${page} من ${totalPages})` : '';

  const payload = {
    friendly_name: friendlyName,
    language: 'ar',
    variables: { '1': itemLabel || 'القسم' },
    types: {
      'twilio/list-picker': {
        body: `اختر طبقاً من {{1}}${pageIndicator}:`,
        button: 'عرض الأطباق',
        items: listItems,
      },
      'twilio/text': {
        body: `أطباق {{1}}${pageIndicator}: ${items
          .map((x) => `${x.item} (${x.price} ${x.currency || 'ر.س'})`)
          .join('، ')}`,
      },
    },
  } as any;

  const sid = await createContent(
    auth,
    payload,
    `Dynamic items list picker created for ${categoryId} (page ${page})`
  );
  return { sid, friendlyName };
}

export async function createPostItemChoiceQuickReply(auth: string): Promise<string> {
  const payload = {
    friendly_name: `post_item_choice_${Date.now()}`,
    language: 'ar',
    types: {
      'twilio/quick-reply': {
        body: 'هل ترغب في إضافة صنف آخر أم المتابعة للدفع؟',
        actions: [
          { id: 'add_item', title: '➕ إضافة صنف', type: 'QUICK_REPLY' },
          { id: 'checkout', title: '🛒 المتابعة للدفع', type: 'QUICK_REPLY' },
          { id: 'view_cart', title: '📋 عرض السلة', type: 'QUICK_REPLY' },
        ],
      },
      'twilio/text': {
        body: 'اكتب: إضافة أو سلة أو دفع.',
      },
    },
  } as any;

  return createContent(auth, payload, 'Quick reply created');
}

export async function createLocationRequestQuickReply(auth: string): Promise<string> {
  const payload = {
    friendly_name: `location_request_${Date.now()}`,
    language: 'ar',
    types: {
      'twilio/quick-reply': {
        body: '📍 شارك موقعك الحالي لحساب رسوم التوصيل.',
        actions: [{ id: 'send_location', title: '📍 إرسال الموقع', type: 'QUICK_REPLY' }],
      },
      'twilio/text': {
        body: 'فضلاً شارك موقعك عبر واتساب.',
      },
    },
  } as any;

  return createContent(auth, payload, 'Location request quick reply created');
}

export async function createQuantityQuickReply(auth: string, itemName: string, quantity: number): Promise<string> {
  const payload = {
    friendly_name: `quantity_${Date.now()}`,
    language: 'ar',
    types: {
      'twilio/quick-reply': {
        body: `تم اختيار ${itemName}.\nاختر الكمية أو أرسل رقماً من 1 إلى ${MAX_ITEM_QUANTITY}. (الحالي: ${quantity})`,
        actions: [
          { id: 'qty_1', title: '1', type: 'QUICK_REPLY' },
          { id: 'qty_2', title: '2', type: 'QUICK_REPLY' },
          { id: 'qty_custom', title: '🔢 كمية أخرى', type: 'QUICK_REPLY' },
        ],
      },
      'twilio/text': {
        body: `اكتب العدد المطلوب من ${itemName} (1-${MAX_ITEM_QUANTITY}).`,
      },
    },
  } as any;

  return createContent(auth, payload, `Quantity quick reply for ${itemName} created`);
}

export async function createCartOptionsQuickReply(auth: string): Promise<string> {
  const payload = {
    friendly_name: `cart_options_${Date.now()}`,
    language: 'ar',
    types: {
      'twilio/quick-reply': {
        body: 'هذه تفاصيل سلتك، ماذا تود أن تفعل؟',
        actions: [
          { id: 'add_item', title: '➕ إضافة أصناف', type: 'QUICK_REPLY' },
          { id: 'remove_item', title: '🗑️ إزالة صنف', type: 'QUICK_REPLY' },
          { id: 'checkout', title: '✅ إتمام الطلب', type: 'QUICK_REPLY' },
        ],
      },
      'twilio/text': {
        body: 'اكتب: إضافة أو إزالة أو دفع.',
      },
    },
  } as any;

  return createContent(auth, payload, 'Cart options quick reply created');
}

export async function createRemoveItemListQuickReply(
  auth: string,
  items: Array<{ id: string; name: string; quantity: number; price: number; currency?: string }>,
  page: number = 1
): Promise<string> {
  const listItems = items.map((entry) => ({
    id: `remove_item_${entry.id}`,
    item: truncateItemTitle(entry.name),
    description: truncateDescription(`${entry.quantity} × ${entry.price} ${entry.currency || 'ر.س'}`),
  }));

  const totalPages = Math.ceil(items.length / MAX_LIST_PICKER_ITEMS);
  const pageIndicator = totalPages > 1 ? ` (صفحة ${page} من ${totalPages})` : '';

  const payload = {
    friendly_name: `remove_item_${Date.now()}_p${page}`,
    language: 'ar',
    types: {
      'twilio/list-picker': {
        body: `اختر الصنف الذي ترغب في حذفه من السلة${pageIndicator}:`,
        button: 'حذف صنف',
        items: listItems,
      },
      'twilio/text': {
        body: `اكتب اسم الصنف الذي ترغب في حذفه${pageIndicator}.`,
      },
    },
  } as any;

  return createContent(auth, payload, `Remove item list created (page ${page})`);
}

export async function createPaymentOptionsQuickReply(auth: string): Promise<string> {
  const payload = {
    friendly_name: `payment_options_${Date.now()}`,
    language: 'ar',
    types: {
      'twilio/quick-reply': {
        body: 'اختر وسيلة الدفع:',
        actions: [
          { id: 'pay_online', title: '💳 دفع إلكتروني', type: 'QUICK_REPLY' },
          { id: 'pay_cash', title: '💵 الدفع عند الاستلام', type: 'QUICK_REPLY' },
        ],
      },
      'twilio/text': {
        body: 'اكتب: إلكتروني أو نقدي.',
      },
    },
  } as any;

  return createContent(auth, payload, 'Payment options quick reply created');
}
