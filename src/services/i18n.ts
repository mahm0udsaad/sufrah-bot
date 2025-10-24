/**
 * Internationalization service for dashboard API responses
 * Provides localized strings, currency formatting, and date formatting
 */

export type Locale = 'en' | 'ar';
export type Currency = 'SAR' | 'USD' | 'EUR';

interface LocalizedStrings {
  [key: string]: {
    en: string;
    ar: string;
  };
}

// Dictionary of localized strings
const strings: LocalizedStrings = {
  'dashboard.overview.title': {
    en: 'Dashboard Overview',
    ar: 'نظرة عامة على لوحة التحكم',
  },
  'dashboard.conversations.active': {
    en: 'Active Conversations',
    ar: 'المحادثات النشطة',
  },
  'dashboard.orders.pending': {
    en: 'Pending Orders',
    ar: 'الطلبات المعلقة',
  },
  'dashboard.sla.breaches': {
    en: 'SLA Breaches',
    ar: 'انتهاكات اتفاقية مستوى الخدمة',
  },
  'dashboard.quota.usage': {
    en: 'Quota Usage',
    ar: 'استخدام الحصة',
  },
  'dashboard.rating.trend': {
    en: 'Rating Trend',
    ar: 'اتجاه التقييم',
  },
  'bot.status.active': {
    en: 'Active',
    ar: 'نشط',
  },
  'bot.status.pending': {
    en: 'Pending',
    ar: 'قيد الانتظار',
  },
  'bot.status.failed': {
    en: 'Failed',
    ar: 'فشل',
  },
  'bot.verification.verified': {
    en: 'Verified',
    ar: 'تم التحقق',
  },
  'bot.verification.unverified': {
    en: 'Unverified',
    ar: 'غير محقق',
  },
  'order.status.draft': {
    en: 'Draft',
    ar: 'مسودة',
  },
  'order.status.confirmed': {
    en: 'Confirmed',
    ar: 'مؤكد',
  },
  'order.status.preparing': {
    en: 'Preparing',
    ar: 'قيد التحضير',
  },
  'order.status.out_for_delivery': {
    en: 'Out for Delivery',
    ar: 'في الطريق للتوصيل',
  },
  'order.status.delivered': {
    en: 'Delivered',
    ar: 'تم التوصيل',
  },
  'order.status.cancelled': {
    en: 'Cancelled',
    ar: 'ملغي',
  },
  'order.status.unknown': {
    en: 'Unknown',
    ar: 'غير معروف',
  },
  'order.customer.unknown': {
    en: 'Unknown',
    ar: 'غير معروف',
  },
  'order.type.delivery': {
    en: 'Delivery',
    ar: 'توصيل',
  },
  'order.type.takeaway': {
    en: 'Takeaway',
    ar: 'استلام من المتجر',
  },
  'order.type.dine_in': {
    en: 'Dine-In',
    ar: 'تناول في المطعم',
  },
  'order.type.from_car': {
    en: 'Drive Thru',
    ar: 'استلام من السيارة',
  },
  'order.type.other': {
    en: 'Other',
    ar: 'أخرى',
  },
  'order.payment.online': {
    en: 'Online Payment',
    ar: 'دفع إلكتروني',
  },
  'order.payment.cash': {
    en: 'Cash Payment',
    ar: 'دفع نقدي',
  },
  'order.payment.other': {
    en: 'Other Payment',
    ar: 'طريقة دفع أخرى',
  },
  'order.alert.late': {
    en: 'Running Late',
    ar: 'تأخير في التجهيز',
  },
  'order.alert.awaiting_payment': {
    en: 'Awaiting Payment',
    ar: 'في انتظار الدفع',
  },
  'order.alert.requires_review': {
    en: 'Needs Review',
    ar: 'يحتاج إلى مراجعة',
  },
  'order.alert.none': {
    en: 'No Alerts',
    ar: 'لا توجد تنبيهات',
  },
  'order.error.not_found': {
    en: 'Order not found',
    ar: 'لم يتم العثور على الطلب',
  },
  'order.error.no_changes': {
    en: 'No valid fields to update',
    ar: 'لا توجد حقول صالحة للتحديث',
  },
  'conversation.channel.bot': {
    en: 'Bot',
    ar: 'بوت',
  },
  'conversation.channel.agent': {
    en: 'Agent',
    ar: 'موظف',
  },
  'conversation.escalated': {
    en: 'Escalated',
    ar: 'تم التصعيد',
  },
  'template.status.approved': {
    en: 'Approved',
    ar: 'معتمد',
  },
  'template.status.pending': {
    en: 'Pending',
    ar: 'قيد المراجعة',
  },
  'template.status.rejected': {
    en: 'Rejected',
    ar: 'مرفوض',
  },
  'template.status.draft': {
    en: 'Draft',
    ar: 'مسودة',
  },
};

/**
 * Get localized string by key
 */
export function t(key: string, locale: Locale = 'en'): string {
  return strings[key]?.[locale] || key;
}

/**
 * Normalize currency code to ISO 4217 standard
 * Maps currency symbols or invalid codes to proper ISO codes
 */
function normalizeCurrency(currency: string | undefined | null): Currency {
  if (!currency || typeof currency !== 'string') {
    return 'SAR';
  }

  const normalized = currency.trim().toUpperCase();
  
  // Map currency symbols to ISO codes
  const currencyMap: { [key: string]: Currency } = {
    'ر.س': 'SAR',
    'SR': 'SAR',
    'SAR': 'SAR',
    'USD': 'USD',
    '$': 'USD',
    'EUR': 'EUR',
    '€': 'EUR',
  };

  return currencyMap[normalized] || currencyMap[currency] || 'SAR';
}

/**
 * Format currency amount
 */
export function formatCurrency(amountCents: number, currency: Currency | string = 'SAR', locale: Locale = 'en'): string {
  const amount = amountCents / 100;
  const normalizedCurrency = normalizeCurrency(currency as string);
  
  const formatter = new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
    style: 'currency',
    currency: normalizedCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  
  return formatter.format(amount);
}

/**
 * Format number with locale-specific formatting
 */
export function formatNumber(value: number, locale: Locale = 'en'): string {
  const formatter = new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US');
  return formatter.format(value);
}

/**
 * Format date with locale-specific formatting
 */
export function formatDate(date: Date | string, locale: Locale = 'en', options?: Intl.DateTimeFormatOptions): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  
  const formatter = new Intl.DateTimeFormat(
    locale === 'ar' ? 'ar-SA' : 'en-US',
    { ...defaultOptions, ...options }
  );
  
  return formatter.format(dateObj);
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date | string, locale: Locale = 'en'): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSeconds < 60) {
    return locale === 'ar' ? 'الآن' : 'just now';
  } else if (diffMinutes < 60) {
    return locale === 'ar' ? `منذ ${diffMinutes} دقيقة` : `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return locale === 'ar' ? `منذ ${diffHours} ساعة` : `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return locale === 'ar' ? `منذ ${diffDays} يوم` : `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } else {
    return formatDate(dateObj, locale, { year: 'numeric', month: 'short', day: 'numeric' });
  }
}

/**
 * Get locale from request headers
 */
export function getLocaleFromRequest(req: Request): Locale {
  const acceptLanguage = req.headers.get('accept-language') || '';
  const locale = acceptLanguage.split(',')[0]?.split('-')[0];
  
  return locale === 'ar' ? 'ar' : 'en';
}

/**
 * Create i18n-friendly response object with localized metadata
 */
export function createLocalizedResponse<T>(
  data: T,
  locale: Locale = 'en',
  currency: Currency = 'SAR'
): {
  data: T;
  meta: {
    locale: Locale;
    currency: Currency;
    timestamp: string;
  };
} {
  return {
    data,
    meta: {
      locale,
      currency,
      timestamp: new Date().toISOString(),
    },
  };
}

function normalizeKey(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

/**
 * Get localized customer display name with fallback
 */
export function getCustomerDisplayName(name: string | null | undefined, locale: Locale = 'en'): string {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    return t('order.customer.unknown', locale);
  }
  return trimmed;
}

/**
 * Get localized label for order type values
 */
export function getOrderTypeDisplay(orderType: string | null | undefined, locale: Locale = 'en'): string {
  const normalized = normalizeKey(orderType);

  switch (normalized) {
    case 'delivery':
      return t('order.type.delivery', locale);
    case 'takeaway':
    case 'take-away':
    case 'take_away':
    case 'pickup':
    case 'pick-up':
    case 'pick_up':
      return t('order.type.takeaway', locale);
    case 'dinein':
    case 'dine_in':
    case 'dine-in':
      return t('order.type.dine_in', locale);
    case 'fromcar':
    case 'from_car':
    case 'from-car':
    case 'drive':
    case 'drive_thru':
    case 'drive-thru':
    case 'drivethru':
      return t('order.type.from_car', locale);
    case 'other':
      return t('order.type.other', locale);
    default:
      return orderType || t('order.type.other', locale);
  }
}

/**
 * Get localized label for order status values with safe fallback
 */
export function getOrderStatusDisplay(status: string | null | undefined, locale: Locale = 'en'): string {
  const normalized = normalizeKey(status);
  if (!normalized) {
    return t('order.status.unknown', locale);
  }

  const key = `order.status.${normalized}`;
  const translated = t(key, locale);
  if (translated === key) {
    return t('order.status.unknown', locale);
  }

  return translated;
}

/**
 * Get localized label for payment methods
 */
export function getPaymentMethodDisplay(paymentMethod: string | null | undefined, locale: Locale = 'en'): string {
  const normalized = normalizeKey(paymentMethod);

  switch (normalized) {
    case 'online':
      return t('order.payment.online', locale);
    case 'cash':
      return t('order.payment.cash', locale);
    case 'card':
    case 'credit':
    case 'debit':
      return t('order.payment.online', locale);
    case 'other':
      return t('order.payment.other', locale);
    default:
      return paymentMethod || t('order.payment.other', locale);
  }
}

interface OrderAlertsInput {
  isLate?: boolean;
  awaitingPayment?: boolean;
  requiresReview?: boolean;
}

/**
 * Translate order alert flags into localized messages
 */
export function getOrderAlertMessages(alerts: OrderAlertsInput, locale: Locale = 'en'): string[] {
  const messages: string[] = [];

  if (alerts.isLate) {
    messages.push(t('order.alert.late', locale));
  }
  if (alerts.awaitingPayment) {
    messages.push(t('order.alert.awaiting_payment', locale));
  }
  if (alerts.requiresReview) {
    messages.push(t('order.alert.requires_review', locale));
  }

  return messages;
}
