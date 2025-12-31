import { SUFRAH_API_BASE, SUFRAH_API_KEY } from '../config';

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/plain;q=0.9',
};

const MERCHANT_PROFILE_CACHE_TTL_MS = Number(process.env.SUFRAH_MERCHANT_CACHE_TTL_MS || 300_000);

async function request<T>(path: string): Promise<T> {
  if (!SUFRAH_API_KEY) {
    throw new Error('Sufrah API key is not configured');
  }

  const url = `${SUFRAH_API_BASE.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  
  console.log(`[Sufrah API] Requesting: ${url}`);

  const response = await fetch(url, {
    headers: {
      ...DEFAULT_HEADERS,
      Authorization: `${SUFRAH_API_KEY}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`[Sufrah API] Error ${response.status}: ${body || response.statusText}`);
    const error = new Error(`Sufrah API ${response.status}: ${body || response.statusText}`);
    (error as any).status = response.status;
    throw error;
  }
  
  console.log(`[Sufrah API] Success: ${response.status}`);

  // Some endpoints return application/json but labeled as text/plain
  try {
    return (await response.json()) as Promise<T>;
  } catch {
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error('Invalid response format from Sufrah API');
    }
  }
}

export interface SufrahCategory {
  id: string;
  nameAr?: string | null;
  nameEn?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
}

export interface SufrahProduct {
  id: string;
  avatar?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  price?: number | string | null;
  priceAfter?: number | string | null;
  currency?: string | null;
  images?: string[] | Array<{ url?: string } | string> | null;
  imageUrl?: string | null;
  media?: Array<{ url?: string }> | null;
  isAvailableToDelivery?: boolean | null;
  isAvailableToReceipt?: boolean | null;
  isAvailableToLocalDemand?: boolean | null;
  isAvailableToOrderFromCar?: boolean | null;
  isPriceIncludingAddons?: boolean | null;
  productAddons?: SufrahProductAddon[] | null;
  options?: SufrahProductOption[] | null;
}

export interface SufrahProductAddon {
  id: string;
  addonId?: string;
  addonNameAr?: string | null;
  addonNameEn?: string | null;
  addonImageUrl?: string | null;
  price?: number | null;
  isWithout?: boolean | null;
  maxQuantity?: number | null;
  minQuantity?: number | null;
}

export interface SufrahProductOption {
  nameAr?: string | null;
  nameEn?: string | null;
  subOptions?: Array<{
    id: string;
    nameAr?: string | null;
    nameEn?: string | null;
    price?: number | null;
  }>;
}

export interface SufrahMerchantProfile {
  id: string;
  email?: string | null;
  phoneNumber?: string | null;
  name?: string | null;
  appsLink?: string | null;
  address?: string | null;
  sloganPhoto?: string | null;
  isActive?: boolean | null;
  subscriptionStatus?: string | null;
}

const merchantProfileCache = new Map<
  string,
  { data: SufrahMerchantProfile; expiresAt: number }
>();

export interface SufrahBranch {
  id: string;
  nameAr?: string | null;
  nameEn?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  address?: string | null;
  addressAr?: string | null;
  addressEn?: string | null;
  city?: {
    id: string;
    nameAr?: string | null;
    nameEn?: string | null;
    areas?: Array<{
      id: string;
      nameAr?: string | null;
      nameEn?: string | null;
      centerLongitude?: number | null;
      centerLatitude?: number | null;
      radius?: number | null;
    }> | null;
  } | null;
  district?: string | null;
  phoneNumber?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  imageUrl?: string | null;
}

export async function fetchMerchantCategories(
  merchantId: string
): Promise<SufrahCategory[]> {
  if (!merchantId) {
    console.error('[Sufrah API] fetchMerchantCategories called with empty merchantId');
    throw new Error('Missing merchant id');
  }
  console.log(`[Sufrah API] Fetching categories for merchant: ${merchantId}`);
  const data = await request<SufrahCategory[] | SufrahCategory>(`merchants/${merchantId}/categories`);
  const result = Array.isArray(data) ? data : [data];
  console.log(`[Sufrah API] Fetched ${result.length} categories`);
  return result;
}

export async function fetchCategoryProducts(
  categoryId: string,
  branchId: string
): Promise<SufrahProduct[]> {
  if (!categoryId) throw new Error('Missing category id');
  if (!branchId) throw new Error('Missing branch id');
  const data = await request<SufrahProduct[] | SufrahProduct>(
    `categories/${categoryId}/products?branchId=${encodeURIComponent(branchId)}`
  );
  return Array.isArray(data) ? data : [data];
}

export async function fetchMerchantBranches(
  merchantId: string
): Promise<SufrahBranch[]> {
  if (!merchantId) {
    console.error('[Sufrah API] fetchMerchantBranches called with empty merchantId');
    throw new Error('Missing merchant id');
  }
  console.log(`[Sufrah API] Fetching branches for merchant: ${merchantId}`);
  const data = await request<SufrahBranch[] | SufrahBranch>(`merchants/${merchantId}/branches`);
  const result = Array.isArray(data) ? data : [data];
  console.log(`[Sufrah API] Fetched ${result.length} branches`);
  return result;
}

export interface DeliveryAvailabilityResult {
  isAvailable: boolean;
  branchId?: string | null;
  nearestBranchId?: string | null;
  raw?: unknown;
}

export async function checkDeliveryAvailability(
  merchantId: string,
  latitude: string | number,
  longitude: string | number
): Promise<DeliveryAvailabilityResult> {
  if (!merchantId) {
    console.error('[Sufrah API] checkDeliveryAvailability called with empty merchantId');
    throw new Error('Missing merchant id');
  }
  if (!latitude || !longitude) {
    console.error('[Sufrah API] checkDeliveryAvailability called with invalid coordinates');
    throw new Error('Missing coordinates');
  }
  
  console.log(`[Sufrah API] Checking delivery availability for merchant: ${merchantId}, lat: ${latitude}, lng: ${longitude}`);
  const response = await request<DeliveryAvailabilityResult | boolean | Record<string, unknown>>(
    `addresses/check-availability?MerchantId=${merchantId}&Lat=${latitude}&Lng=${longitude}`
  );

  console.log(`[Sufrah API] Delivery availability response:`, response);

  if (typeof response === 'boolean') {
    return { isAvailable: response, raw: response };
  }

  if (response && typeof response === 'object') {
    const isAvailable =
      response.isAvailable === true ||
      response.available === true ||
      response === true;
    const branchId =
      (response as any).branchId ||
      (response as any).nearestBranchId ||
      null;
    return {
      isAvailable: isAvailable || !!branchId,
      branchId: typeof branchId === 'string' ? branchId : null,
      nearestBranchId: typeof branchId === 'string' ? branchId : null,
      raw: response,
    };
  }

  return { isAvailable: false, raw: response };
}

export async function fetchMerchantProfile(
  merchantId: string
): Promise<SufrahMerchantProfile | null> {
  if (!merchantId) {
    console.error('[Sufrah API] fetchMerchantProfile called with empty merchantId');
    return null;
  }

  const cached = merchantProfileCache.get(merchantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const data = await request<SufrahMerchantProfile>(`merchants/${merchantId}`);
    const normalized: SufrahMerchantProfile = {
      id: data.id,
      email: data.email ?? null,
      phoneNumber: data.phoneNumber ?? null,
      name: data.name ?? null,
      appsLink: data.appsLink ?? null,
      address: data.address ?? null,
      sloganPhoto: data.sloganPhoto ?? null,
      isActive: data.isActive ?? null,
      subscriptionStatus: data.subscriptionStatus ?? null,
    };

    merchantProfileCache.set(merchantId, {
      data: normalized,
      expiresAt: Date.now() + MERCHANT_PROFILE_CACHE_TTL_MS,
    });

    return normalized;
  } catch (error) {
    console.error(`❌ [Sufrah API] Failed to fetch merchant profile for ${merchantId}:`, error);
    return null;
  }
}
