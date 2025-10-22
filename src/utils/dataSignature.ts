import { hashObject } from './hash';
import type { MenuCategory, MenuItem, BranchOption } from '../workflows/menuData';

/**
 * Normalizes menu category data for deterministic hashing.
 * Strips transient fields and sorts arrays to ensure consistent hash generation.
 */
export function normalizeCategoryData(
  categories: MenuCategory[],
  options: { page?: number; merchantId?: string } = {}
): Record<string, unknown> {
  const normalized = categories
    .map((category) => ({
      id: category.id,
      item: category.item,
      description: category.description ?? null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    type: 'categories',
    merchantId: options.merchantId,
    page: options.page ?? 1,
    categories: normalized,
  };
}

/**
 * Normalizes branch data for deterministic hashing.
 */
export function normalizeBranchData(
  branches: BranchOption[],
  options: { page?: number; merchantId?: string } = {}
): Record<string, unknown> {
  const normalized = branches
    .map((branch) => ({
      id: branch.id,
      item: branch.item,
      description: branch.description ?? null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    type: 'branches',
    merchantId: options.merchantId,
    page: options.page ?? 1,
    branches: normalized,
  };
}

/**
 * Normalizes menu item data for deterministic hashing.
 */
export function normalizeItemData(
  items: MenuItem[],
  options: { page?: number; categoryId?: string; merchantId?: string } = {}
): Record<string, unknown> {
  const normalized = items
    .map((item) => ({
      id: item.id,
      item: item.item,
      description: item.description ?? null,
      price: item.price,
      currency: item.currency ?? 'ر.س',
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    type: 'items',
    merchantId: options.merchantId,
    categoryId: options.categoryId,
    page: options.page ?? 1,
    items: normalized,
  };
}

/**
 * Normalizes quantity prompt data for deterministic hashing.
 */
export function normalizeQuantityData(itemName: string, maxQuantity: number): Record<string, unknown> {
  return {
    type: 'quantity',
    itemName: itemName.trim(),
    maxQuantity,
  };
}

/**
 * Normalizes cart item data for remove-item list hashing.
 */
export function normalizeRemoveItemData(
  items: Array<{ id: string; name: string; quantity: number; price: number; currency?: string }>,
  options: { page?: number } = {}
): Record<string, unknown> {
  const normalized = items
    .map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      currency: item.currency ?? 'ر.س',
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    type: 'remove_item',
    page: options.page ?? 1,
    items: normalized,
  };
}

/**
 * Helper to generate a data signature from normalized data.
 */
export function generateDataSignature(normalizedData: Record<string, unknown>): string {
  return hashObject(normalizedData);
}

/**
 * Generates a short hash suffix for friendly names (first 8 chars of hash).
 */
export function getHashSuffix(hash: string, length: number = 8): string {
  return hash.slice(0, length);
}

/**
 * Sanitizes merchant/category IDs for use in friendly names.
 */
export function sanitizeIdForName(id: string, maxLength: number = 6): string {
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(-maxLength) || 'unknown';
}

