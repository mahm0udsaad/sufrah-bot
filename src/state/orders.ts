import type { CartItem, OrderState } from '../types';

const carts = new Map<string, CartItem[]>();
const orderStates = new Map<string, OrderState>();

export function getCart(phone: string): CartItem[] {
  if (!carts.has(phone)) carts.set(phone, []);
  return carts.get(phone)!;
}

export function clearCart(phone: string): void {
  carts.set(phone, []);
}

export function getOrderState(phone: string): OrderState {
  if (!orderStates.has(phone)) orderStates.set(phone, {});
  return orderStates.get(phone)!;
}

export function resetOrder(phone: string): void {
  clearCart(phone);
  orderStates.set(phone, {});
}

export function updateOrderState(phone: string, update: Partial<OrderState>): void {
  const current = getOrderState(phone);
  orderStates.set(phone, { ...current, ...update });
}

export function setPendingItem(
  phone: string,
  item: Omit<CartItem, 'quantity'> | undefined,
  quantity: number = 1
): void {
  updateOrderState(phone, {
    pendingItem: item,
    pendingQuantity: item ? Math.max(1, quantity) : undefined,
  });
}

export function addItemToCart(
  phone: string,
  item: Omit<CartItem, 'quantity'>,
  quantity: number
): CartItem {
  const cart = getCart(phone);
  const existing = cart.find((entry) => entry.id === item.id);
  const safeQuantity = Math.max(1, quantity);
  if (existing) {
    existing.quantity += safeQuantity;
    return existing;
  }
  const newEntry: CartItem = { ...item, quantity: safeQuantity };
  cart.push(newEntry);
  return newEntry;
}

export function setItemQuantity(
  phone: string,
  itemId: string,
  quantity: number
): CartItem | undefined {
  const cart = getCart(phone);
  const entry = cart.find((item) => item.id === itemId);
  if (!entry) return undefined;
  entry.quantity = Math.max(1, quantity);
  return entry;
}

export function removeItemFromCart(phone: string, itemId: string): void {
  const cart = getCart(phone);
  const index = cart.findIndex((item) => item.id === itemId);
  if (index >= 0) {
    cart.splice(index, 1);
  }
}

export function isCartEmpty(phone: string): boolean {
  return getCart(phone).length === 0;
}

export function getActiveCartsCount(): number {
  return carts.size;
}

export function calculateCartTotal(cart: CartItem[]): { total: number; currency?: string } {
  let total = 0;
  let currency: string | undefined;
  cart.forEach((item) => {
    const lineTotal = item.price * item.quantity;
    total += lineTotal;
    if (!currency && item.currency) {
      currency = item.currency;
    }
  });
  const roundedTotal = Number.isFinite(total) ? Number(total.toFixed(2)) : 0;
  return { total: roundedTotal, currency };
}

export function formatCartMessage(cart: CartItem[]): string {
  if (!cart.length) {
    return '🛒 السلة فارغة.';
  }
  const lines = cart.map((item) => {
    const lineTotal = Number((item.price * item.quantity).toFixed(2));
    return `${item.quantity} × ${item.name} — ${lineTotal} ${item.currency || 'ر.س'}`;
  });
  const { total, currency } = calculateCartTotal(cart);
  return `🛒 السلة الحالية:\n\n${lines.join('\n')}\n\nالإجمالي: ${total} ${currency || 'ر.س'}`;
}

export function generateOrderReference(): string {
  const randomSegment = Math.random().toString(36).slice(-5).toUpperCase();
  const timestamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `ORD-${timestamp}-${randomSegment}`;
}
