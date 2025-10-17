import { SUFRAH_API_BASE, SUFRAH_API_KEY } from '../config';

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/json',
};

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
}

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
  categoryId: string
): Promise<SufrahProduct[]> {
  if (!categoryId) throw new Error('Missing category id');
  const data = await request<SufrahProduct[] | SufrahProduct>(`categories/${categoryId}/products`);
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
