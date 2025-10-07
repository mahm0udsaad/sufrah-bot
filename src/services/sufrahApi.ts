import { SUFRAH_API_BASE, SUFRAH_API_KEY } from '../config';

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'text/plain',
};

async function request<T>(path: string): Promise<T> {
  if (!SUFRAH_API_KEY) {
    throw new Error('Sufrah API key is not configured');
  }

  const url = `${SUFRAH_API_BASE.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

  const response = await fetch(url, {
    headers: {
      ...DEFAULT_HEADERS,
      Authorization: `${SUFRAH_API_KEY}`,
    },
  });

  if (!response.ok) {
    const error = new Error(`Sufrah API request failed with status ${response.status}`);
    (error as any).status = response.status;
    throw error;
  }

  return response.json() as Promise<T>;
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
  nameAr?: string | null;
  nameEn?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  price?: number | string | null;
  currency?: string | null;
  images?: Array<{ url?: string } | string> | null;
  imageUrl?: string | null;
  media?: Array<{ url?: string }> | null;
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
  return request<SufrahCategory[]>(`merchants/${merchantId}/categories`);
}

export async function fetchCategoryProducts(
  categoryId: string
): Promise<SufrahProduct[]> {
  return request<SufrahProduct[]>(`categories/${categoryId}/products`);
}

export async function fetchMerchantBranches(
  merchantId: string
): Promise<SufrahBranch[]> {
  return request<SufrahBranch[]>(`merchants/${merchantId}/branches`);
}
