import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { prisma } from './client';
import { standardizeWhatsappNumber } from '../utils/phone';

export interface SufrahRestaurant {
  id: string;
  name?: string | null;
  whatsappNumber: string;
  externalMerchantId: string;
}

type PrismaRestaurantModel = {
  findFirst: (args: { where: { whatsappNumber: string } }) => Promise<any>;
};

function getRestaurantModel(): PrismaRestaurantModel | null {
  const client = prisma as unknown as { restaurant?: PrismaRestaurantModel };
  if (!client.restaurant || typeof client.restaurant.findFirst !== 'function') {
    return null;
  }
  return client.restaurant;
}

interface RawRestaurantRow {
  id: string;
  name?: string | null;
  whatsapp_number?: string | null;
  external_merchant_id?: string | null;
}

function isMissingColumnError(error: unknown): error is PrismaClientKnownRequestError {
  return (
    error instanceof PrismaClientKnownRequestError &&
    error.code === 'P2022'
  );
}

async function fetchRestaurantByWhatsappRaw(normalized: string): Promise<RawRestaurantRow | null> {
  try {
    const rows = await prisma.$queryRaw<RawRestaurantRow[]>`
      SELECT
        id,
        name,
        whatsapp_number,
        external_merchant_id
      FROM "RestaurantProfile"
      WHERE whatsapp_number = ${normalized}
      LIMIT 1
    `;

    return rows[0] ?? null;
  } catch (error) {
    console.error('❌ Failed raw restaurant lookup:', error);
    return null;
  }
}

function mapToRestaurant(record: any, normalized: string): SufrahRestaurant | null {
  if (!record) {
    return null;
  }

  const externalMerchantId =
    record.externalMerchantId ||
    record.external_merchant_id;

  if (!externalMerchantId) {
    return null;
  }

  const whatsapp =
    record.whatsappNumber ||
    record.whatsapp_number ||
    normalized;

  return {
    id: record.id,
    name: record.name ?? record.restaurantName ?? null,
    whatsappNumber: whatsapp,
    externalMerchantId,
  };
}

export async function getRestaurantByWhatsapp(
  whatsappNumber: string
): Promise<SufrahRestaurant | null> {
  const normalized = standardizeWhatsappNumber(whatsappNumber);
  if (!normalized) {
    return null;
  }

  const restaurantModel = getRestaurantModel();
  let record: any = null;

  if (restaurantModel) {
    try {
      record = await restaurantModel.findFirst({ where: { whatsappNumber: normalized } });
    } catch (error) {
      if (isMissingColumnError(error)) {
        console.warn('⚠️ Restaurant lookup falling back to raw SQL due to schema drift (missing column).');
      } else {
        throw error;
      }
    }
  } else {
    console.warn('⚠️ Prisma client does not expose a restaurant model. Falling back to raw SQL.');
  }

  if (!record) {
    record = await fetchRestaurantByWhatsappRaw(normalized);
  }

  return mapToRestaurant(record, normalized);
}
