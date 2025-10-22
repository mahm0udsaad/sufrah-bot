import { describe, test, expect } from 'bun:test';
import {
  normalizeCategoryData,
  normalizeBranchData,
  normalizeItemData,
  normalizeQuantityData,
  normalizeRemoveItemData,
  generateDataSignature,
  getHashSuffix,
  sanitizeIdForName,
} from '../src/utils/dataSignature';
import type { MenuCategory, MenuItem, BranchOption } from '../src/workflows/menuData';

describe('Data Signature - Hash Consistency', () => {
  describe('normalizeCategoryData', () => {
    test('should produce same hash for categories in different order', () => {
      const categories1: MenuCategory[] = [
        { id: 'cat_2', item: 'Pizza', description: 'Hot pizzas' },
        { id: 'cat_1', item: 'Burgers', description: 'Tasty burgers' },
      ];

      const categories2: MenuCategory[] = [
        { id: 'cat_1', item: 'Burgers', description: 'Tasty burgers' },
        { id: 'cat_2', item: 'Pizza', description: 'Hot pizzas' },
      ];

      const normalized1 = normalizeCategoryData(categories1, { merchantId: 'M1', page: 1 });
      const normalized2 = normalizeCategoryData(categories2, { merchantId: 'M1', page: 1 });

      const hash1 = generateDataSignature(normalized1);
      const hash2 = generateDataSignature(normalized2);

      expect(hash1).toBe(hash2);
    });

    test('should produce different hash when data changes', () => {
      const categories1: MenuCategory[] = [
        { id: 'cat_1', item: 'Burgers', description: 'Tasty burgers' },
      ];

      const categories2: MenuCategory[] = [
        { id: 'cat_1', item: 'Burgers', description: 'NEW DESCRIPTION' },
      ];

      const hash1 = generateDataSignature(normalizeCategoryData(categories1, { merchantId: 'M1', page: 1 }));
      const hash2 = generateDataSignature(normalizeCategoryData(categories2, { merchantId: 'M1', page: 1 }));

      expect(hash1).not.toBe(hash2);
    });

    test('should produce different hash for different pages', () => {
      const categories: MenuCategory[] = [
        { id: 'cat_1', item: 'Burgers', description: 'Tasty burgers' },
      ];

      const hash1 = generateDataSignature(normalizeCategoryData(categories, { merchantId: 'M1', page: 1 }));
      const hash2 = generateDataSignature(normalizeCategoryData(categories, { merchantId: 'M1', page: 2 }));

      expect(hash1).not.toBe(hash2);
    });

    test('should handle null descriptions consistently', () => {
      const categories1: MenuCategory[] = [
        { id: 'cat_1', item: 'Burgers', description: null },
      ];

      const categories2: MenuCategory[] = [
        { id: 'cat_1', item: 'Burgers', description: undefined },
      ];

      const hash1 = generateDataSignature(normalizeCategoryData(categories1, { merchantId: 'M1', page: 1 }));
      const hash2 = generateDataSignature(normalizeCategoryData(categories2, { merchantId: 'M1', page: 1 }));

      expect(hash1).toBe(hash2);
    });
  });

  describe('normalizeBranchData', () => {
    test('should produce same hash for branches in different order', () => {
      const branches1: BranchOption[] = [
        { id: 'br_2', item: 'Uptown', description: '456 Oak' },
        { id: 'br_1', item: 'Downtown', description: '123 Main' },
      ];

      const branches2: BranchOption[] = [
        { id: 'br_1', item: 'Downtown', description: '123 Main' },
        { id: 'br_2', item: 'Uptown', description: '456 Oak' },
      ];

      const hash1 = generateDataSignature(normalizeBranchData(branches1, { merchantId: 'M1', page: 1 }));
      const hash2 = generateDataSignature(normalizeBranchData(branches2, { merchantId: 'M1', page: 1 }));

      expect(hash1).toBe(hash2);
    });

    test('should produce different hash when branch added', () => {
      const branches1: BranchOption[] = [
        { id: 'br_1', item: 'Downtown', description: '123 Main' },
      ];

      const branches2: BranchOption[] = [
        { id: 'br_1', item: 'Downtown', description: '123 Main' },
        { id: 'br_2', item: 'Uptown', description: '456 Oak' },
      ];

      const hash1 = generateDataSignature(normalizeBranchData(branches1, { merchantId: 'M1', page: 1 }));
      const hash2 = generateDataSignature(normalizeBranchData(branches2, { merchantId: 'M1', page: 1 }));

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('normalizeItemData', () => {
    test('should produce same hash for items in different order', () => {
      const items1: MenuItem[] = [
        { id: 'item_2', item: 'Fries', description: 'Crispy', price: 10, currency: 'SAR' },
        { id: 'item_1', item: 'Burger', description: 'Classic', price: 25, currency: 'SAR' },
      ];

      const items2: MenuItem[] = [
        { id: 'item_1', item: 'Burger', description: 'Classic', price: 25, currency: 'SAR' },
        { id: 'item_2', item: 'Fries', description: 'Crispy', price: 10, currency: 'SAR' },
      ];

      const options = { merchantId: 'M1', categoryId: 'cat_1', page: 1 };
      const hash1 = generateDataSignature(normalizeItemData(items1, options));
      const hash2 = generateDataSignature(normalizeItemData(items2, options));

      expect(hash1).toBe(hash2);
    });

    test('should produce different hash when price changes', () => {
      const items1: MenuItem[] = [
        { id: 'item_1', item: 'Burger', description: 'Classic', price: 25.00, currency: 'SAR' },
      ];

      const items2: MenuItem[] = [
        { id: 'item_1', item: 'Burger', description: 'Classic', price: 28.00, currency: 'SAR' },
      ];

      const options = { merchantId: 'M1', categoryId: 'cat_1', page: 1 };
      const hash1 = generateDataSignature(normalizeItemData(items1, options));
      const hash2 = generateDataSignature(normalizeItemData(items2, options));

      expect(hash1).not.toBe(hash2);
    });

    test('should normalize currency consistently', () => {
      const items1: MenuItem[] = [
        { id: 'item_1', item: 'Burger', description: 'Classic', price: 25, currency: undefined },
      ];

      const items2: MenuItem[] = [
        { id: 'item_1', item: 'Burger', description: 'Classic', price: 25, currency: 'ر.س' },
      ];

      const options = { merchantId: 'M1', categoryId: 'cat_1', page: 1 };
      const hash1 = generateDataSignature(normalizeItemData(items1, options));
      const hash2 = generateDataSignature(normalizeItemData(items2, options));

      expect(hash1).toBe(hash2);
    });
  });

  describe('normalizeQuantityData', () => {
    test('should produce same hash for same item name', () => {
      const hash1 = generateDataSignature(normalizeQuantityData('Burger', 20));
      const hash2 = generateDataSignature(normalizeQuantityData('Burger', 20));

      expect(hash1).toBe(hash2);
    });

    test('should produce different hash for different item names', () => {
      const hash1 = generateDataSignature(normalizeQuantityData('Burger', 20));
      const hash2 = generateDataSignature(normalizeQuantityData('Pizza', 20));

      expect(hash1).not.toBe(hash2);
    });

    test('should trim whitespace consistently', () => {
      const hash1 = generateDataSignature(normalizeQuantityData('  Burger  ', 20));
      const hash2 = generateDataSignature(normalizeQuantityData('Burger', 20));

      expect(hash1).toBe(hash2);
    });

    test('should produce different hash when max quantity changes', () => {
      const hash1 = generateDataSignature(normalizeQuantityData('Burger', 20));
      const hash2 = generateDataSignature(normalizeQuantityData('Burger', 30));

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('normalizeRemoveItemData', () => {
    test('should produce same hash for items in different order', () => {
      const items1 = [
        { id: 'item_2', name: 'Fries', quantity: 1, price: 10, currency: 'SAR' },
        { id: 'item_1', name: 'Burger', quantity: 2, price: 25, currency: 'SAR' },
      ];

      const items2 = [
        { id: 'item_1', name: 'Burger', quantity: 2, price: 25, currency: 'SAR' },
        { id: 'item_2', name: 'Fries', quantity: 1, price: 10, currency: 'SAR' },
      ];

      const hash1 = generateDataSignature(normalizeRemoveItemData(items1, { page: 1 }));
      const hash2 = generateDataSignature(normalizeRemoveItemData(items2, { page: 1 }));

      expect(hash1).toBe(hash2);
    });

    test('should produce different hash when quantity changes', () => {
      const items1 = [
        { id: 'item_1', name: 'Burger', quantity: 2, price: 25, currency: 'SAR' },
      ];

      const items2 = [
        { id: 'item_1', name: 'Burger', quantity: 3, price: 25, currency: 'SAR' },
      ];

      const hash1 = generateDataSignature(normalizeRemoveItemData(items1, { page: 1 }));
      const hash2 = generateDataSignature(normalizeRemoveItemData(items2, { page: 1 }));

      expect(hash1).not.toBe(hash2);
    });

    test('should produce different hash when item removed', () => {
      const items1 = [
        { id: 'item_1', name: 'Burger', quantity: 2, price: 25, currency: 'SAR' },
        { id: 'item_2', name: 'Fries', quantity: 1, price: 10, currency: 'SAR' },
      ];

      const items2 = [
        { id: 'item_1', name: 'Burger', quantity: 2, price: 25, currency: 'SAR' },
      ];

      const hash1 = generateDataSignature(normalizeRemoveItemData(items1, { page: 1 }));
      const hash2 = generateDataSignature(normalizeRemoveItemData(items2, { page: 1 }));

      expect(hash1).not.toBe(hash2);
    });
  });
});

describe('Helper Functions', () => {
  describe('getHashSuffix', () => {
    test('should return first 8 characters by default', () => {
      const hash = 'abcdef1234567890';
      expect(getHashSuffix(hash)).toBe('abcdef12');
    });

    test('should respect custom length', () => {
      const hash = 'abcdef1234567890';
      expect(getHashSuffix(hash, 4)).toBe('abcd');
    });
  });

  describe('sanitizeIdForName', () => {
    test('should remove special characters', () => {
      expect(sanitizeIdForName('merchant-123_abc')).toBe('123abc');
    });

    test('should limit length to 6 by default', () => {
      expect(sanitizeIdForName('12345678901234567890')).toBe('567890');
    });

    test('should respect custom length', () => {
      expect(sanitizeIdForName('12345678901234567890', 10)).toBe('1234567890');
    });

    test('should handle empty strings', () => {
      expect(sanitizeIdForName('')).toBe('unknown');
    });

    test('should handle strings with only special characters', () => {
      expect(sanitizeIdForName('---___')).toBe('unknown');
    });
  });
});

describe('Real-World Scenarios', () => {
  test('Menu update: category renamed', () => {
    const before: MenuCategory[] = [
      { id: 'cat_1', item: 'Burgers', description: 'Delicious burgers' },
      { id: 'cat_2', item: 'Pizza', description: 'Hot pizzas' },
    ];

    const after: MenuCategory[] = [
      { id: 'cat_1', item: 'Burgers', description: 'Delicious burgers' },
      { id: 'cat_2', item: 'Pizzas', description: 'Hot pizzas' }, // Renamed
    ];

    const hashBefore = generateDataSignature(normalizeCategoryData(before, { merchantId: 'M1', page: 1 }));
    const hashAfter = generateDataSignature(normalizeCategoryData(after, { merchantId: 'M1', page: 1 }));

    expect(hashBefore).not.toBe(hashAfter);
  });

  test('Price increase: item price changed', () => {
    const morningPrices: MenuItem[] = [
      { id: 'item_1', item: 'Burger', description: 'Classic', price: 25.00, currency: 'SAR' },
    ];

    const eveningPrices: MenuItem[] = [
      { id: 'item_1', item: 'Burger', description: 'Classic', price: 28.00, currency: 'SAR' },
    ];

    const options = { merchantId: 'M1', categoryId: 'cat_1', page: 1 };
    const hashMorning = generateDataSignature(normalizeItemData(morningPrices, options));
    const hashEvening = generateDataSignature(normalizeItemData(eveningPrices, options));

    expect(hashMorning).not.toBe(hashEvening);
  });

  test('New branch opened', () => {
    const beforeBranches: BranchOption[] = [
      { id: 'br_1', item: 'Downtown', description: '123 Main St' },
      { id: 'br_2', item: 'Uptown', description: '456 Oak Ave' },
    ];

    const afterBranches: BranchOption[] = [
      { id: 'br_1', item: 'Downtown', description: '123 Main St' },
      { id: 'br_2', item: 'Uptown', description: '456 Oak Ave' },
      { id: 'br_3', item: 'Westside', description: '789 Pine Rd' }, // New branch
    ];

    const hashBefore = generateDataSignature(normalizeBranchData(beforeBranches, { merchantId: 'M1', page: 1 }));
    const hashAfter = generateDataSignature(normalizeBranchData(afterBranches, { merchantId: 'M1', page: 1 }));

    expect(hashBefore).not.toBe(hashAfter);
  });

  test('Same menu, multiple customers', () => {
    const menu: MenuCategory[] = [
      { id: 'cat_1', item: 'Burgers', description: 'Tasty burgers' },
      { id: 'cat_2', item: 'Pizza', description: 'Hot pizzas' },
    ];

    // Simulate 5 customers viewing the same menu
    const hashes = Array.from({ length: 5 }, () =>
      generateDataSignature(normalizeCategoryData(menu, { merchantId: 'M1', page: 1 }))
    );

    // All hashes should be identical
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(1);
  });

  test('Cart with same items, different customers', () => {
    const cart = [
      { id: 'item_1', name: 'Burger', quantity: 2, price: 25, currency: 'SAR' },
      { id: 'item_2', name: 'Fries', quantity: 1, price: 10, currency: 'SAR' },
    ];

    // Customer A and Customer B have identical carts
    const hashA = generateDataSignature(normalizeRemoveItemData(cart, { page: 1 }));
    const hashB = generateDataSignature(normalizeRemoveItemData(cart, { page: 1 }));

    expect(hashA).toBe(hashB);
  });
});

