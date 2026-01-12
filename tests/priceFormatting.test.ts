import { describe, it, expect } from 'bun:test';

// Helper to format item price display (matches implementation in quickReplies.ts)
function formatItemPrice(item: { price: number; priceAfter?: number; currency?: string }): string {
  const currency = item.currency || 'ر.س';
  const hasDiscount = item.priceAfter !== undefined && 
                      item.priceAfter !== null && 
                      item.priceAfter > 0 && 
                      item.priceAfter < item.price;
  
  if (hasDiscount) {
    return `قبل: ${item.price} ${currency} • الآن: ${item.priceAfter} ${currency}`;
  }
  
  return `${item.price} ${currency}`;
}

describe('Price Formatting', () => {
  it('should format regular price without discount', () => {
    const item = { price: 35, currency: 'ر.س' };
    expect(formatItemPrice(item)).toBe('35 ر.س');
  });

  it('should format discounted price correctly', () => {
    const item = { price: 35, priceAfter: 25, currency: 'ر.س' };
    expect(formatItemPrice(item)).toBe('قبل: 35 ر.س • الآن: 25 ر.س');
  });

  it('should not show discount when priceAfter equals price', () => {
    const item = { price: 35, priceAfter: 35, currency: 'ر.س' };
    expect(formatItemPrice(item)).toBe('35 ر.س');
  });

  it('should not show discount when priceAfter is greater than price', () => {
    const item = { price: 35, priceAfter: 40, currency: 'ر.س' };
    expect(formatItemPrice(item)).toBe('35 ر.س');
  });

  it('should not show discount when priceAfter is zero', () => {
    const item = { price: 35, priceAfter: 0, currency: 'ر.س' };
    expect(formatItemPrice(item)).toBe('35 ر.س');
  });

  it('should use default currency when not specified', () => {
    const item = { price: 35 };
    expect(formatItemPrice(item)).toBe('35 ر.س');
  });

  it('should handle different currencies', () => {
    const item = { price: 35, priceAfter: 25, currency: 'SAR' };
    expect(formatItemPrice(item)).toBe('قبل: 35 SAR • الآن: 25 SAR');
  });

  it('should handle undefined priceAfter', () => {
    const item = { price: 35, priceAfter: undefined, currency: 'ر.س' };
    expect(formatItemPrice(item)).toBe('35 ر.س');
  });

  it('should handle null priceAfter', () => {
    const item = { price: 35, priceAfter: null as any, currency: 'ر.س' };
    expect(formatItemPrice(item)).toBe('35 ر.س');
  });
});
