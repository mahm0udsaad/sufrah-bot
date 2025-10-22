import { Prisma } from '@prisma/client';
import { prisma } from './client';

export interface ContentTemplateCacheRecord {
  id: string;
  key: string;
  dataHash: string;
  templateSid: string;
  friendlyName: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date;
}

interface FindParams {
  key: string;
  dataHash: string;
}

interface SaveParams {
  key: string;
  dataHash: string;
  templateSid: string;
  friendlyName?: string | null;
  metadata?: Prisma.JsonValue;
}

export async function findContentTemplateCache(
  params: FindParams
): Promise<ContentTemplateCacheRecord | null> {
  const { key, dataHash } = params;
  return prisma.contentTemplateCache.findUnique({
    where: {
      key_dataHash: {
        key,
        dataHash,
      },
    },
  });
}

export async function upsertContentTemplateCache(params: SaveParams): Promise<void> {
  const { key, dataHash, templateSid } = params;
  const friendlyName = params.friendlyName ?? undefined;
  const metadata = params.metadata ?? undefined;

  const updateData: Prisma.ContentTemplateCacheUpdateInput = {
    templateSid,
    lastUsedAt: new Date(),
  };

  if (friendlyName !== undefined) {
    updateData.friendlyName = friendlyName;
  }

  if (metadata !== undefined) {
    updateData.metadata = metadata;
  }

  await prisma.contentTemplateCache.upsert({
    where: {
      key_dataHash: {
        key,
        dataHash,
      },
    },
    create: {
      key,
      dataHash,
      templateSid,
      friendlyName: friendlyName ?? null,
      metadata: metadata ?? null,
    },
    update: updateData,
  });
}

export async function touchContentTemplateCache(params: FindParams): Promise<void> {
  const { key, dataHash } = params;
  try {
    await prisma.contentTemplateCache.update({
      where: {
        key_dataHash: {
          key,
          dataHash,
        },
      },
      data: {
        lastUsedAt: new Date(),
      },
    });
  } catch (error) {
    // Ignore not found errors – cache entry might be missing if overrides were used
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return;
    }
    throw error;
  }
}
