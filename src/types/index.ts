import twilio from 'twilio';

export type TwilioClient = ReturnType<typeof twilio>;

export type OrderType = 'delivery' | 'pickup';

export interface CartAddon {
  id: string;
  name: string;
  price: number;
  quantity: number;
  currency?: string;
}

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  currency?: string;
  image?: string;
  notes?: string;
  addons?: CartAddon[];
}

export interface OrderState {
  type?: OrderType;
  locationAddress?: string;
  awaitingLocation?: boolean;
  latitude?: string;
  longitude?: string;
  pendingItem?: Omit<CartItem, 'quantity'>;
  pendingQuantity?: number;
  paymentMethod?: 'online' | 'cash';
  awaitingRemoval?: boolean;
  orderReference?: string;
  statusStage?: number;
  lastStatusMessage?: string;
  branchId?: string;
  branchName?: string;
  branchAddress?: string;
  awaitingOrderReference?: boolean;
  lastQueriedReference?: string;
  restaurant?: {
    id: string;
    name?: string | null;
    whatsappNumber: string;
    externalMerchantId: string;
    appsLink?: string | null;
    sloganPhoto?: string | null;
    merchantEmail?: string | null;
    merchantPhone?: string | null;
  };
  activeCategoryId?: string;
  customerName?: string;
  awaitingRatingComment?: boolean;
  pendingRatingValue?: number;
  pendingRatingOrderId?: string;
}

export type MessageType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'template'
  | 'interactive';

export interface StoredMessage {
  id: string;
  conversationId: string;
  fromPhone: string;
  toPhone: string;
  messageType: MessageType;
  content: string;
  mediaUrl?: string | null;
  timestamp: string;
  isFromCustomer: boolean;
}

export interface StoredConversation {
  id: string;
  customerPhone: string;
  customerName?: string;
  status: 'active' | 'closed';
  lastMessageAt?: string;
  unreadCount: number;
  isBotActive: boolean;
  createdAt: string;
  updatedAt: string;
}
