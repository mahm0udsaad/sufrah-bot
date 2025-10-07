import { SUFRAH_CACHE_TTL_MS } from '../config';
import {
  fetchCategoryProducts,
  fetchMerchantBranches,
  fetchMerchantCategories,
  type SufrahBranch,
  type SufrahCategory,
  type SufrahProduct,
} from '../services/sufrahApi';

export const MAX_ITEM_QUANTITY = 20;

export interface MenuCategory {
  id: string;
  item: string;
  description?: string;
  raw: SufrahCategory;
}

export interface MenuItem {
  id: string;
  item: string;
  description?: string;
  price: number;
  currency?: string;
  image?: string;
  categoryId: string;
  raw: SufrahProduct;
}

export interface BranchOption {
  id: string;
  item: string;
  description: string;
  raw: SufrahBranch;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface MenuCacheEntry {
  categories?: CacheEntry<MenuCategory[]>;
  branches?: CacheEntry<BranchOption[]>;
  products: Map<string, CacheEntry<MenuItem[]>>;
  productIndex: Map<string, MenuItem>;
}

const merchantCache = new Map<string, MenuCacheEntry>();

function getCache(merchantId: string): MenuCacheEntry {
  if (!merchantCache.has(merchantId)) {
    merchantCache.set(merchantId, {
      products: new Map(),
      productIndex: new Map(),
    });
  }
  return merchantCache.get(merchantId)!;
}

function isExpired<T>(entry: CacheEntry<T> | undefined): boolean {
  if (!entry) {
    return true;
  }
  return entry.expiresAt <= Date.now();
}

function toCacheEntry<T>(data: T): CacheEntry<T> {
  return {
    data,
    expiresAt: Date.now() + Math.max(30_000, SUFRAH_CACHE_TTL_MS),
  };
}

function preferArabic(ar?: string | null, en?: string | null): string | undefined {
  const arSafe = (ar ?? '').trim();
  const enSafe = (en ?? '').trim();
  if (arSafe) return arSafe;
  if (enSafe) return enSafe;
  return undefined;
}

function resolveCategory(category: SufrahCategory): MenuCategory | null {
  const item = preferArabic(category.nameAr, category.nameEn) ?? '';
  if (!item) {
    return null;
  }
  const description = preferArabic(category.descriptionAr, category.descriptionEn);
  return {
    id: category.id,
    item,
    description,
    raw: category,
  };
}

function parsePrice(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^\d.\-]/g, ''));
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function resolveImage(product: SufrahProduct): string | undefined {
  if (Array.isArray(product.images) && product.images.length > 0) {
    const [first] = product.images;
    if (typeof first === 'string') {
      return first;
    }
    if (first && typeof first === 'object') {
      return first.url || undefined;
    }
  }

  if (Array.isArray(product.media) && product.media.length > 0) {
    const [first] = product.media;
    if (first && typeof first.url === 'string') {
      return first.url;
    }
  }

  if (typeof product.imageUrl === 'string' && product.imageUrl.trim()) {
    return product.imageUrl.trim();
  }

  return undefined;
}

function resolveDescription(product: SufrahProduct): string | undefined {
  return preferArabic(product.descriptionAr, product.descriptionEn);
}

function resolveMenuItem(product: SufrahProduct, categoryId: string): MenuItem | null {
  const item = preferArabic(product.nameAr, product.nameEn) ?? '';
  if (!item) {
    return null;
  }

  const price = parsePrice(product.price);
  const currency = (product.currency ?? 'ر.س') || 'ر.س';
  const description = resolveDescription(product);
  const image = resolveImage(product);

  return {
    id: product.id,
    item,
    description,
    price,
    currency,
    image,
    categoryId,
    raw: product,
  };
}

function resolveBranch(branch: SufrahBranch): BranchOption | null {
  const item = preferArabic(branch.nameAr, branch.nameEn) ?? '';
  if (!item) {
    return null;
  }

  const descriptionText = preferArabic(branch.descriptionAr, branch.descriptionEn);
  const addressText = preferArabic(branch.addressAr, branch.addressEn) || branch.address;
  const cityName = preferArabic(branch.city?.nameAr, branch.city?.nameEn);
  const areaNames = (branch.city?.areas || [])
    .map((area) => preferArabic(area?.nameAr, area?.nameEn))
    .filter((name): name is string => !!name && name.trim().length > 0);
  const districtName = branch.district?.trim();

  const locationParts: string[] = [];
  if (cityName) {
    locationParts.push(cityName.trim());
  }
  if (areaNames.length) {
    locationParts.push(areaNames.join('، '));
  }
  if (districtName) {
    locationParts.push(districtName);
  }
  if (addressText) {
    locationParts.push(addressText.trim());
  }

  const description =
    descriptionText ||
    (locationParts.length ? locationParts.join(' — ') : undefined) ||
    'سيتم تأكيد العنوان بعد الحجز';

  return {
    id: branch.id,
    item,
    description,
    raw: branch,
  };
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[إأآ]/g, 'ا')
    .replace(/\s+/g, ' ');
}

export async function getMenuCategories(merchantId: string): Promise<MenuCategory[]> {
  const cache = getCache(merchantId);
  if (!cache.categories || isExpired(cache.categories)) {
    const raw = await fetchMerchantCategories(merchantId);
    const mapped = raw
      .map(resolveCategory)
      .filter((category): category is MenuCategory => category !== null);
    cache.categories = toCacheEntry(mapped);
  }
  cache.categories = cache.categories ?? toCacheEntry<MenuCategory[]>([]);
  return cache.categories.data;
}

export async function getCategoryById(
  merchantId: string,
  categoryId: string
): Promise<MenuCategory | undefined> {
  const categories = await getMenuCategories(merchantId);
  return categories.find((category) => category.id === categoryId);
}

export async function findCategoryByText(
  merchantId: string,
  input: string
): Promise<MenuCategory | undefined> {
  const categories = await getMenuCategories(merchantId);
  const normalized = normalizeText(input);
  if (!normalized) {
    return undefined;
  }

  const numeric = Number.parseInt(normalized, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= categories.length) {
    return categories[numeric - 1];
  }

  return categories.find((category) => normalizeText(category.item).includes(normalized));
}

export async function getCategoryItems(
  merchantId: string,
  categoryId: string
): Promise<MenuItem[]> {
  const cache = getCache(merchantId);
  const cached = cache.products.get(categoryId);
  if (!cached || isExpired(cached)) {
    const raw = await fetchCategoryProducts(categoryId);
    const mapped = raw
      .map((product) => resolveMenuItem(product, categoryId))
      .filter((product): product is MenuItem => product !== null);

    const entry = toCacheEntry(mapped);
    cache.products.set(categoryId, entry);
    mapped.forEach((item) => cache.productIndex.set(item.id, item));
    return mapped;
  }

  return cached.data;
}

export async function getItemById(
  merchantId: string,
  itemId: string
): Promise<MenuItem | undefined> {
  const cache = getCache(merchantId);
  const indexed = cache.productIndex.get(itemId);
  if (indexed) {
    return indexed;
  }

  const categories = await getMenuCategories(merchantId);
  for (const category of categories) {
    const items = await getCategoryItems(merchantId, category.id);
    const match = items.find((item) => item.id === itemId);
    if (match) {
      return match;
    }
  }
  return undefined;
}

export async function findItemByText(
  merchantId: string,
  categoryId: string | undefined,
  input: string
): Promise<MenuItem | undefined> {
  const normalized = normalizeText(input);
  if (!normalized) {
    return undefined;
  }

  if (normalized.startsWith('item_')) {
    const id = normalized.replace(/^item_/, '');
    return getItemById(merchantId, id);
  }

  const numeric = Number.parseInt(normalized, 10);
  if (!Number.isNaN(numeric) && numeric >= 1) {
    if (categoryId) {
      const items = await getCategoryItems(merchantId, categoryId);
      if (numeric <= items.length) {
        return items[numeric - 1];
      }
    }
  }

  if (categoryId) {
    const items = await getCategoryItems(merchantId, categoryId);
    return items.find((item) => normalizeText(item.item).includes(normalized));
  }

  const cache = getCache(merchantId);
  for (const item of cache.productIndex.values()) {
    if (normalizeText(item.item).includes(normalized)) {
      return item;
    }
  }

  return undefined;
}

export async function getMerchantBranches(
  merchantId: string
): Promise<BranchOption[]> {
  const cache = getCache(merchantId);
  if (!cache.branches || isExpired(cache.branches)) {
    const raw = await fetchMerchantBranches(merchantId);
    const mapped = raw
      .map(resolveBranch)
      .filter((branch): branch is BranchOption => branch !== null);
    cache.branches = toCacheEntry(mapped);
  }
  cache.branches = cache.branches ?? toCacheEntry<BranchOption[]>([]);
  return cache.branches.data;
}

export async function getBranchById(
  merchantId: string,
  branchId: string
): Promise<BranchOption | undefined> {
  const branches = await getMerchantBranches(merchantId);
  return branches.find((branch) => branch.id === branchId);
}

export async function findBranchByText(
  merchantId: string,
  input: string
): Promise<BranchOption | undefined> {
  const branches = await getMerchantBranches(merchantId);
  const normalized = normalizeText(input);
  if (!normalized) {
    return undefined;
  }

  const numeric = Number.parseInt(normalized, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= branches.length) {
    return branches[numeric - 1];
  }

  return branches.find((branch) => {
    const nameNormalized = normalizeText(branch.item);
    const descNormalized = normalizeText(branch.description);
    return nameNormalized.includes(normalized) || descNormalized.includes(normalized);
  });
}
