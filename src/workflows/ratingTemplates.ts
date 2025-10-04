/**
 * WhatsApp interactive templates for post-order rating and promo flow
 * Based on requirements in DASHBOARD_CONTEXT.md
 */

export interface InteractiveMessage {
  type: string;
  interactive: any;
}

/**
 * A) "Order Delivered" - Initial prompt with buttons
 */
export function createOrderDeliveredTemplate(): InteractiveMessage {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: 'تم تسليم طلبك! كيف كانت التجربة؟' },
      footer: { text: 'شكراً لاختيارك مطعمنا 🍽️' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'rate_now', title: 'قيّم الآن' } },
          { type: 'reply', reply: { id: 'rate_later', title: 'لاحقاً' } },
          { type: 'reply', reply: { id: 'rate_support', title: 'مساعدة' } },
        ],
      },
    },
  };
}

/**
 * B) "Rate Now" - List with 5 star options
 */
export function createRatingListTemplate(): InteractiveMessage {
  return {
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'تقييم التجربة' },
      body: { text: 'اختر تقييمك من 1 إلى 5 ⭐' },
      action: {
        button: 'اختيار التقييم',
        sections: [
          {
            title: 'التقييم',
            rows: [
              { id: 'rate_5', title: '⭐⭐⭐⭐⭐ (5)', description: 'ممتاز' },
              { id: 'rate_4', title: '⭐⭐⭐⭐ (4)', description: 'جيد جداً' },
              { id: 'rate_3', title: '⭐⭐⭐ (3)', description: 'جيد' },
              { id: 'rate_2', title: '⭐⭐ (2)', description: 'مقبول' },
              { id: 'rate_1', title: '⭐ (1)', description: 'ضعيف' },
            ],
          },
        ],
      },
    },
  };
}

/**
 * C) "Thank You + Promo" - For ratings ≥ 4
 */
export function createThankYouPromoTemplate(
  restaurantDomain: string = 'example.com'
): InteractiveMessage {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: 'شكراً لتقييمك! ادعمنا بمشاركة التطبيق أو زيارة موقعنا 🙌',
      },
      action: {
        buttons: [
          {
            type: 'url',
            url: `https://${restaurantDomain}/app`,
            title: 'تحميل التطبيق',
          },
          {
            type: 'url',
            url: `https://${restaurantDomain}`,
            title: 'زيارة الموقع',
          },
        ],
      },
    },
  };
}

/**
 * D) "We're sorry" - For ratings ≤ 3 (text message)
 */
export function createSorryMessageText(): string {
  return 'نعتذر عن أي إزعاج. أخبرنا بالمشكلة لنقوم بحلّها سريعاً، أو اطلب تواصل من الدعم بكتابة: "تواصل معي".';
}

/**
 * Parse rating from button reply ID
 */
export function parseRatingFromReply(replyId: string): number | null {
  const match = replyId.match(/^rate_(\d+)$/);
  if (match && match[1]) {
    const rating = parseInt(match[1], 10);
    if (rating >= 1 && rating <= 5) {
      return rating;
    }
  }
  return null;
}

/**
 * Check if rating is positive (4 or 5)
 */
export function isPositiveRating(rating: number): boolean {
  return rating >= 4;
}

