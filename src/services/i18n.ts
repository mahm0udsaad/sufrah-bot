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
 * Format currency amount
 */
export function formatCurrency(amountCents: number, currency: Currency = 'SAR', locale: Locale = 'en'): string {
  const amount = amountCents / 100;
  
  const formatter = new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
    style: 'currency',
    currency,
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

