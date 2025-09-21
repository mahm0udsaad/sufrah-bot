import { rememberTemplateText, registerTemplateTextForKey, registerTemplateTextForSid } from './templateText';

const contentSidCache = new Map<string, string>();

const CONTENT_OVERRIDES: Record<string, string | undefined> = {
  welcome: process.env.CONTENT_SID_WELCOME,
  order_type: process.env.CONTENT_SID_ORDER_TYPE,
  categories: process.env.CONTENT_SID_CATEGORIES,
  post_item_choice: process.env.CONTENT_SID_POST_ITEM_CHOICE,
  location_request: process.env.CONTENT_SID_LOCATION_REQUEST,
  quantity_prompt: process.env.CONTENT_SID_QUANTITY,
  cart_options: process.env.CONTENT_SID_CART_OPTIONS,
  payment_options: process.env.CONTENT_SID_PAYMENT_OPTIONS,
  branch_list: process.env.CONTENT_SID_BRANCH_LIST,
};

export function cacheContentSid(key: string, sid: string) {
  contentSidCache.set(key, sid);
}

export async function getCachedContentSid(
  key: string,
  creator: () => Promise<string>,
  displayText?: string
): Promise<string> {
  if (displayText) {
    registerTemplateTextForKey(key, displayText);
  }

  if (contentSidCache.has(key)) {
    const sid = contentSidCache.get(key)!;
    rememberTemplateText(key, sid);
    registerTemplateTextForSid(sid, displayText);
    return sid;
  }

  const override = CONTENT_OVERRIDES[key];
  if (override) {
    cacheContentSid(key, override);
    rememberTemplateText(key, override);
    registerTemplateTextForSid(override, displayText);
    return override;
  }

  const sid = await creator();
  cacheContentSid(key, sid);
  rememberTemplateText(key, sid);
  registerTemplateTextForSid(sid, displayText);
  return sid;
}

export function seedCacheFromKey(key: string, sid: string) {
  if (sid) {
    cacheContentSid(key, sid);
    rememberTemplateText(key, sid);
  }
}

export function exportCache() {
  return { contentSidCache, CONTENT_OVERRIDES };
}
