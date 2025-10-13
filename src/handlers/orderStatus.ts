import { getOrderState, updateOrderState } from '../state/orders';
import { sendTextMessage } from '../twilio/messaging';
import { TwilioClientManager } from '../twilio/clientManager';

// Order status simulation constants and state
export const ORDER_STATUS_SEQUENCE = [
  '🧾 تم استلام الطلب وجارٍ مراجعته.',
  '👨‍🍳 يتم تجهيز طلبك الآن.',
  '🛵 انطلق سائق التوصيل بالطلب.',
  '✅ تم تسليم الطلب. نتمنى لك وجبة شهية!'
];

export const orderStatusTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function stopOrderStatusSimulation(phoneNumber: string) {
  const timer = orderStatusTimers.get(phoneNumber);
  if (timer) {
    clearTimeout(timer);
    orderStatusTimers.delete(phoneNumber);
  }
}

export function scheduleNextOrderStatus(phoneNumber: string) {
  const state = getOrderState(phoneNumber);
  const nextStage = state.statusStage ?? 0;
  if (nextStage >= ORDER_STATUS_SEQUENCE.length) {
    stopOrderStatusSimulation(phoneNumber);
    return;
  }

  const timer = setTimeout(() => {
    orderStatusTimers.delete(phoneNumber);
    advanceOrderStatus(phoneNumber).catch((error) => {
      console.error('❌ Error advancing order status:', error);
    });
  }, 60_000);

  orderStatusTimers.set(phoneNumber, timer);
}

export async function advanceOrderStatus(phoneNumber: string): Promise<void> {
  const state = getOrderState(phoneNumber);
  const nextStage = state.statusStage ?? 0;
  if (nextStage >= ORDER_STATUS_SEQUENCE.length) {
    stopOrderStatusSimulation(phoneNumber);
    return;
  }

  const statusMessage = ORDER_STATUS_SEQUENCE[nextStage];
  const orderRef = state.orderReference ? `\nرقم الطلb: ${state.orderReference}` : '';
  const restaurant = state.restaurant;
  if (!restaurant) {
    console.error('❌ Cannot advance order status without restaurant context');
    return;
  }

  const twilioClientManager = new TwilioClientManager();
  const twilioClient = await twilioClientManager.getClient(restaurant.id);
  if (!twilioClient) {
    console.error(`❌ Twilio client not available for restaurant ${restaurant.id}`);
    return;
  }

  await sendTextMessage(
    twilioClient,
    restaurant.whatsappNumber || process.env.TWILIO_WHATSAPP_FROM || '',
    phoneNumber,
    `${statusMessage}${orderRef}`
  );

  updateOrderState(phoneNumber, {
    statusStage: nextStage + 1,
    lastStatusMessage: statusMessage,
  });

  scheduleNextOrderStatus(phoneNumber);
}

export async function startOrderStatusSimulation(phoneNumber: string): Promise<void> {
  const state = getOrderState(phoneNumber);
  if ((state.statusStage ?? 0) >= ORDER_STATUS_SEQUENCE.length) {
    return;
  }

  if (orderStatusTimers.has(phoneNumber)) {
    return;
  }

  await advanceOrderStatus(phoneNumber);
}
