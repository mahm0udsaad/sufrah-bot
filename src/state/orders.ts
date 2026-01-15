import type { CartAddon, CartItem, OrderState } from '../types';

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

export function resetOrder(phone: string, options?: { preserveRestaurant?: boolean }): void {
  const current = getOrderState(phone);
  clearCart(phone);
  const baseState: OrderState = {};
  if (options?.preserveRestaurant && current.restaurant) {
    baseState.restaurant = current.restaurant;
  }
  orderStates.set(phone, baseState);
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
  const safeQuantity = Math.max(1, quantity);
  const normalizedAddons = normalizeAddons(item.addons);
  const itemSignature = buildItemSignature(item.id, normalizedAddons, item.notes);
  const existing = cart.find((entry) =>
    buildItemSignature(entry.id, normalizeAddons(entry.addons), entry.notes) === itemSignature
  );

  if (existing) {
    existing.quantity += safeQuantity;
    existing.addons = normalizedAddons;
    existing.price = item.price;
    existing.priceAfter = item.priceAfter;
    existing.notes = item.notes ?? existing.notes;
    return existing;
  }

  const newEntry: CartItem = {
    ...item,
    addons: normalizedAddons,
    quantity: safeQuantity,
  };
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
    const basePrice =
      item.priceAfter !== null && item.priceAfter !== undefined
        ? normalizeNumber(item.priceAfter)
        : normalizeNumber(item.price);
    const baseTotal = basePrice * Math.max(1, item.quantity);
    const addonsTotal = normalizeAddons(item.addons).reduce((sum, addon) => {
      if (!currency && addon.currency) {
        currency = addon.currency;
      }
      return sum + addon.price * addon.quantity;
    }, 0);

    total += baseTotal + addonsTotal;
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
  const lines = cart.flatMap((item) => {
    const unitPrice =
      item.priceAfter !== null && item.priceAfter !== undefined
        ? normalizeNumber(item.priceAfter)
        : normalizeNumber(item.price);
    const baseTotal = Number((unitPrice * item.quantity).toFixed(2));
    const baseLine = `${item.quantity} × ${item.name} — ${baseTotal} ${item.currency || 'ر.س'}`;
    const addonLines = normalizeAddons(item.addons).map((addon) => {
      const addonTotal = Number((addon.price * addon.quantity).toFixed(2));
      return `  • ${addon.quantity} × ${addon.name} — ${addonTotal} ${addon.currency || item.currency || 'ر.س'}`;
    });
    return [baseLine, ...addonLines];
  });
  const { total, currency } = calculateCartTotal(cart);
  return `🛒 السلة الحالية:\n\n${lines.join('\n')}\n\nالإجمالي: ${total} ${currency || 'ر.س'}`;
}

export function generateOrderReference(): string {
  const randomSegment = Math.random().toString(36).slice(-5).toUpperCase();
  const timestamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `ORD-${timestamp}-${randomSegment}`;
}

function normalizeAddons(addons: CartAddon[] | undefined): CartAddon[] {
  if (!Array.isArray(addons)) {
    return [];
  }
  return addons
    .filter((addon) => addon && typeof addon.id === 'string')
    .map((addon) => ({
      id: addon.id,
      name: addon.name,
      price: normalizeNumber(addon.price),
      quantity: Math.max(1, Math.round(normalizeNumber(addon.quantity) || 1)),
      currency: addon.currency,
    }));
}

function buildItemSignature(id: string, addons: CartAddon[], notes?: string): string {
  const addonsKey = [...addons]
    .map((addon) => `${addon.id}:${addon.quantity}`)
    .sort()
    .join('|');
  const notesKey = (notes || '').trim().toLowerCase();
  return `${id}::${addonsKey}::${notesKey}`;
}

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number.parseFloat(value.replace(/[^\d.\-]/g, ''));
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}
