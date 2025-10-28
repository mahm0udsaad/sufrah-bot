import { Prisma, NotificationStatus, NotificationType } from '@prisma/client';
import { prisma } from '../db/client';
import { eventBus } from '../redis/eventBus';
import { TwilioClientManager } from '../twilio/clientManager';
import { sendNotification } from './whatsapp';

const twilioClientManager = new TwilioClientManager();

export interface NotificationRecordInput {
  restaurantId: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, any>;
  status?: NotificationStatus;
}

export interface NotificationListResult {
  notifications: NotificationApiResponse[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface NotificationApiResponse {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  status: NotificationStatus;
  metadata: Record<string, any> | null;
}

const WELCOME_MESSAGE_AR =
  'مرحبًا بك في منصة سفرة! يسعدنا تواجدك معنا، وسنكون معك خطوة بخطوة لمساعدتك في إدارة محادثات وطلبات عملائك.';

function mapNotificationToApi(notification: {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: Date;
  status: NotificationStatus;
  metadata: Prisma.JsonValue | null;
}): NotificationApiResponse {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    createdAt: notification.createdAt.toISOString(),
    status: notification.status,
    metadata: (notification.metadata as Record<string, any> | null) ?? null,
  };
}

async function publishRealtimeNotification(
  restaurantId: string,
  notification: NotificationApiResponse
) {
  await eventBus.publishNotification(restaurantId, {
    type: 'notification.created',
    notification,
  });
}

export async function createNotificationRecord(
  input: NotificationRecordInput
): Promise<NotificationApiResponse> {
  const notification = await prisma.notification.create({
    data: {
      restaurantId: input.restaurantId,
      type: input.type,
      title: input.title,
      body: input.body,
      metadata: (input.metadata ?? null) as Prisma.InputJsonValue,
      status: input.status ?? NotificationStatus.unread,
    },
  });

  const apiNotification = mapNotificationToApi(notification);
  await publishRealtimeNotification(input.restaurantId, apiNotification);

  return apiNotification;
}

export async function listNotificationsForRestaurant(
  restaurantId: string,
  limit: number,
  cursor?: string
): Promise<NotificationListResult> {
  const take = Math.min(Math.max(limit, 1), 100);

  const notifications = await prisma.notification.findMany({
    where: { restaurantId },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor
      ? {
          skip: 1,
          cursor: { id: cursor },
        }
      : {}),
  });

  const hasMore = notifications.length > take;
  const slice = hasMore ? notifications.slice(0, take) : notifications;
  const nextCursor = hasMore ? slice[slice.length - 1]!.id : null;

  const unreadCount = await prisma.notification.count({
    where: {
      restaurantId,
      status: NotificationStatus.unread,
    },
  });

  return {
    notifications: slice.map(mapNotificationToApi),
    nextCursor,
    unreadCount,
  };
}

export async function markNotificationsRead(
  restaurantId: string,
  notificationIds: string[]
): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: {
      restaurantId,
      id: { in: notificationIds },
      status: NotificationStatus.unread,
    },
    data: {
      status: NotificationStatus.read,
      readAt: new Date(),
    },
  });

  return result.count;
}

export async function notifyConversationStarted(options: {
  restaurantId: string;
  conversationId: string;
  customerName?: string | null;
  customerPhone: string;
}) {
  const customerName = options.customerName?.trim();
  const displayName = customerName && customerName.length > 0 ? customerName : options.customerPhone;

  await createNotificationRecord({
    restaurantId: options.restaurantId,
    type: NotificationType.conversation_started,
    title: `محادثة جديدة مع ${displayName}`,
    body: 'بدأ العميل محادثة جديدة عبر واتساب. افتح المحادثة للرد فورًا.',
    metadata: {
      conversationId: options.conversationId,
      customerName: customerName ?? null,
      customerPhone: options.customerPhone,
    },
  });
}

export async function notifyOrderCreated(options: {
  restaurantId: string;
  orderId: string;
  orderReference: string;
  totalCents: number;
  currency: string | null;
  conversationId: string;
  customerName?: string | null;
  customerPhone?: string | null;
}) {
  const currency = options.currency ?? 'SAR';
  const totalSAR = (options.totalCents ?? 0) / 100;
  const roundedTotal = totalSAR.toLocaleString('ar-SA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const customerName = options.customerName?.trim();
  const displayName = customerName && customerName.length > 0 ? customerName : 'عميل';

  await createNotificationRecord({
    restaurantId: options.restaurantId,
    type: NotificationType.order_created,
    title: `طلب جديد من ${displayName}`,
    body: `تم استلام طلب جديد رقم ${options.orderReference} بقيمة ${roundedTotal} ${currency}.`,
    metadata: {
      orderId: options.orderId,
      orderReference: options.orderReference,
      totalCents: options.totalCents,
      currency,
      conversationId: options.conversationId,
      customerName: customerName ?? null,
      customerPhone: options.customerPhone ?? null,
    },
  });
}

export async function sendWelcomeBroadcast(options: {
  restaurantId: string;
  restaurantName?: string | null;
  force?: boolean;
}): Promise<{
  delivered: number;
  skipped: number;
  failed: number;
}> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: options.restaurantId },
    select: {
      id: true,
      name: true,
      whatsappNumber: true,
    },
  });

  if (!restaurant) {
    throw new Error(`Restaurant ${options.restaurantId} not found`);
  }

  const client = await twilioClientManager.getClient(options.restaurantId);
  if (!client) {
    throw new Error(`Twilio client not available for restaurant ${options.restaurantId}`);
  }

  const fromNumber = restaurant.whatsappNumber ?? undefined;
  const conversations = await prisma.conversation.findMany({
    where: { restaurantId: options.restaurantId },
    select: {
      id: true,
      customerWa: true,
      customerName: true,
    },
  });

  let delivered = 0;
  let skipped = 0;
  const failures: Array<{ conversationId: string; error: string }> = [];

  for (const conversation of conversations) {
    if (!conversation.customerWa) {
      skipped += 1;
      continue;
    }

    try {
      await sendNotification(client, conversation.customerWa, WELCOME_MESSAGE_AR, {
        fromNumber,
        forceFreeform: options.force ?? false,
      });
      delivered += 1;
    } catch (error: any) {
      failures.push({
        conversationId: conversation.id,
        error: error?.message || 'unknown-error',
      });
    }
  }

  await createNotificationRecord({
    restaurantId: options.restaurantId,
    type: NotificationType.welcome_broadcast,
    title: 'رسالة ترحيبية للعملاء',
    body: `تم إرسال رسالة ترحيبية باللغة العربية إلى ${delivered} عميل.`,
    metadata: {
      delivered,
      skipped,
      failed: failures.length,
      failures,
      message: WELCOME_MESSAGE_AR,
    },
    status: NotificationStatus.unread,
  });

  return {
    delivered,
    skipped,
    failed: failures.length,
  };
}

export async function sendWelcomeBroadcastForAllRestaurants(): Promise<{
  restaurantsProcessed: number;
  results: Array<{ restaurantId: string; delivered: number; skipped: number; failed: number }>;
}> {
  const restaurants = await prisma.restaurant.findMany({
    where: { status: { not: 'INACTIVE' } },
    select: { id: true, name: true },
  });

  const aggregate: Array<{ restaurantId: string; delivered: number; skipped: number; failed: number }> = [];

  for (const restaurant of restaurants) {
    try {
      const result = await sendWelcomeBroadcast({ restaurantId: restaurant.id });
      aggregate.push({ restaurantId: restaurant.id, ...result });
    } catch (error) {
      console.error(`❌ Failed to send welcome broadcast for restaurant ${restaurant.id}:`, error);
      aggregate.push({ restaurantId: restaurant.id, delivered: 0, skipped: 0, failed: 1 });
    }
  }

  return { restaurantsProcessed: restaurants.length, results: aggregate };
}

export { mapNotificationToApi };
