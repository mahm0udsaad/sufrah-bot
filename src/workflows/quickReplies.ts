import { createContent } from '../twilio/content';
import { MAX_ITEM_QUANTITY, type BranchOption, type MenuItem, type MenuCategory } from './menuData';

const MAX_LIST_PICKER_ITEMS = 10;

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
  page: number = 1
): Promise<string> {
  const items = categories.map((category) => ({
    id: `cat_${category.id}`,
    item: category.item,
    description: category.description,
  }));

  const totalPages = Math.ceil(items.length / MAX_LIST_PICKER_ITEMS);
  const pageIndicator = totalPages > 1 ? ` (صفحة ${page} من ${totalPages})` : '';

  const payload = {
    friendly_name: `food_list_${Date.now()}_p${page}`,
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

  return createContent(auth, payload, `Dynamic list picker created (page ${page})`);
}

export async function createBranchListPicker(
  auth: string,
  branches: BranchOption[],
  page: number = 1
): Promise<string> {
  const pickerItems = branches.map((branch) => ({
    id: `branch_${branch.id}`,
    item: branch.item,
    description: branch.description,
  }));

  const totalPages = Math.ceil(branches.length / MAX_LIST_PICKER_ITEMS);
  const pageIndicator = totalPages > 1 ? ` (صفحة ${page} من ${totalPages})` : '';

  const payload = {
    friendly_name: `branch_list_${Date.now()}_p${page}`,
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

  return createContent(auth, payload, `Branch list picker created (page ${page})`);
}

export async function createItemsListPicker(
  auth: string,
  categoryId: string,
  itemLabel: string,
  items: MenuItem[],
  page: number = 1
): Promise<string> {
  const listItems = items.map((item) => ({
    id: `item_${item.id}`,
    item: item.item,
    description: item.description
      ? `${item.description} • ${item.price} ${item.currency || 'ر.س'}`
      : `${item.price} ${item.currency || 'ر.س'}`,
  }));

  const totalPages = Math.ceil(items.length / MAX_LIST_PICKER_ITEMS);
  const pageIndicator = totalPages > 1 ? ` (صفحة ${page} من ${totalPages})` : '';

  const payload = {
    friendly_name: `items_list_${categoryId}_${Date.now()}_p${page}`,
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

  return createContent(auth, payload, `Dynamic items list picker created for ${categoryId} (page ${page})`);
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
    item: entry.name,
    description: `${entry.quantity} × ${entry.price} ${entry.currency || 'ر.س'}`,
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
