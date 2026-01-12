import redis from '../redis/client';
import { normalizePhoneNumber } from '../utils/phone';

// Keep conversation session longer to allow post-order actions like ratings
const SESSION_TTL_SECONDS = 7200; // 2 hours

function isRedisReady(): boolean {
  return (redis as any)?.status === 'ready';
}

export interface SelectedBranchSession {
  branchId: string;
  phoneNumber?: string | null;
  nameEn?: string | null;
  nameAr?: string | null;
  raw?: unknown;
}

export interface SessionOrderAddon {
  id: string;
  name: string;
  price: number;
  quantity: number;
  currency?: string;
}

export interface SessionOrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  currency?: string;
  notes?: string;
  addons: SessionOrderAddon[];
}

export interface ConversationSession {
  selectedBranch?: SelectedBranchSession;
  merchantId?: string;
  branchId?: string;
  branchName?: string;
  branchPhone?: string;
  orderType?: string;
  paymentMethod?: string;
  items?: SessionOrderItem[];
  total?: number;
  currency?: string;
  customerName?: string;
  customerPhone?: string;
  customerPhoneRaw?: string;
  lastOrderNumber?: number;
  lastUserMessageAt?: number; // timestamp in ms for idle detection
}

function buildSessionKey(conversationId: string): string {
  const normalized = normalizePhoneNumber(conversationId);
  return `conversation:${normalized}:session`;
}

export async function getConversationSession(
  conversationId: string
): Promise<ConversationSession | null> {
  if (!isRedisReady()) {
    return null;
  }
  try {
    const raw = await redis.get(buildSessionKey(conversationId));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as ConversationSession;
      }
    } catch (error) {
      console.warn('⚠️ Failed to parse conversation session payload:', error);
    }

    return null;
  } catch (error) {
    console.error('❌ Failed to load conversation session from Redis:', error);
    return null;
  }
}

export async function setConversationSession(
  conversationId: string,
  session: ConversationSession,
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<void> {
  if (!isRedisReady()) {
    return;
  }
  try {
    await redis.setex(
      buildSessionKey(conversationId),
      ttlSeconds,
      JSON.stringify(session)
    );
  } catch (error) {
    console.error('❌ Failed to persist conversation session to Redis:', error);
  }
}

export async function updateConversationSession(
  conversationId: string,
  update: Partial<ConversationSession>,
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<void> {
  if (!isRedisReady()) {
    return;
  }
  const current = (await getConversationSession(conversationId)) ?? {};
  const next = { ...current, ...update } satisfies ConversationSession;
  await setConversationSession(conversationId, next, ttlSeconds);
}

export async function clearConversationSession(conversationId: string): Promise<void> {
  if (!isRedisReady()) {
    return;
  }
  try {
    await redis.del(buildSessionKey(conversationId));
  } catch (error) {
    console.error('❌ Failed to clear conversation session from Redis:', error);
  }
}
