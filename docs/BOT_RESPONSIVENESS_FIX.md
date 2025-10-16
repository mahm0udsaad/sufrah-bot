# Bot Responsiveness Issue After Server Restart

## Problem

After server restart (`pm2 restart all`), the bot doesn't respond to customers who had previous conversations. Customer has to send multiple messages or wait for another restart before bot responds.

## Root Cause

The bot message processing logic uses **in-memory session state** that is cleared on restart:

### Files Using In-Memory State

**`src/handlers/processMessage.ts`** uses:
- `getOrderState(phone)` - Order state (cart, items, etc.)
- `getConversationSession(phone)` - Conversation session (stage, data)
- `hasWelcomed(phone)` - Whether user was welcomed
- `getCart(phone)` - Shopping cart contents

**`src/state/orders.ts`** - In-memory Map for orders
**`src/state/session.ts`** - In-memory Map for sessions
**`src/state/bot.ts`** - In-memory Set for welcomed users

### What Happens on Restart

```
1. Customer sends message
   ↓
2. Webhook handler receives it ✅
   ↓
3. Conversation found in database ✅
   ↓
4. Message saved to database ✅
   ↓
5. processMessage() called
   ↓
6. Bot checks in-memory session state ❌
   ↓
7. Session not found (memory cleared) ❌
   ↓
8. Bot doesn't know conversation context ❌
   ↓
9. Bot doesn't respond properly ❌
```

## Solution Options

### Option 1: Persist Session State to Redis (Recommended)

Store session state in Redis instead of memory so it persists across restarts.

**Pros:**
- Survives restarts
- Shared across multiple instances
- Fast access
- TTL support for session expiry

**Cons:**
- Requires Redis (already in use)
- Need to serialize/deserialize state

### Option 2: Graceful Session Recovery

When session not found in memory, reconstruct it from database:

**Pros:**
- No additional storage needed
- Simple to implement
- Works with existing database

**Cons:**
- Slight delay on first message after restart
- Need to query database for each missing session

### Option 3: Make Bot Stateless

Redesign bot to not rely on session state, always determine context from database:

**Pros:**
- Most robust
- No session management complexity
- Naturally multi-instance

**Cons:**
- Major refactoring required
- May lose some features

## Quick Fix: Session Recovery (Recommended for Now)

Add session recovery logic to `processMessage`:

### Step 1: Create Session Recovery Function

Create `src/state/sessionRecovery.ts`:

```typescript
import { prisma } from '../db/client';
import { updateConversationSession } from './session';
import { updateOrderState } from './orders';

/**
 * Attempt to recover session state from database after restart
 */
export async function recoverSessionFromDatabase(
  customerPhone: string
): Promise<boolean> {
  try {
    // Find most recent active conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        customerWa: customerPhone,
        status: 'active',
      },
      orderBy: {
        lastMessageAt: 'desc',
      },
      include: {
        orders: {
          where: {
            status: { in: ['DRAFT', 'CONFIRMED', 'PREPARING'] },
          },
          orderBy: {
            updatedAt: 'desc',
          },
          take: 1,
          include: {
            items: true,
          },
        },
      },
    });

    if (!conversation) {
      console.log(`📝 No active conversation found for ${customerPhone}`);
      return false;
    }

    console.log(`🔄 Recovering session for ${customerPhone} from database`);

    // Reconstruct session state
    const order = conversation.orders[0];
    if (order) {
      // Restore order state
      const cart = order.items.map((item) => ({
        itemId: item.id,
        name: item.name,
        quantity: item.qty,
        unitPrice: item.unitCents / 100,
        totalPrice: item.totalCents / 100,
        addons: [], // Addons not stored separately, would need to parse metadata
      }));

      updateOrderState(customerPhone, {
        orderType: order.orderType as any,
        cart,
        deliveryAddress: order.deliveryAddress || undefined,
        deliveryLat: order.deliveryLat || undefined,
        deliveryLng: order.deliveryLng || undefined,
        paymentMethod: order.paymentMethod || undefined,
        branchId: order.branchId || undefined,
        branchName: order.branchName || undefined,
        orderReference: order.orderReference || undefined,
      });

      // Restore conversation session (approximate stage based on order state)
      const stage = order.orderType
        ? order.cart && order.cart.length > 0
          ? 'browsing_items'
          : 'choosing_category'
        : 'choosing_order_type';

      updateConversationSession(customerPhone, {
        stage: stage as any,
        orderType: order.orderType as any,
      });

      console.log(`✅ Recovered session for ${customerPhone}: stage=${stage}`);
      return true;
    }

    console.log(`📝 No active order found for ${customerPhone}`);
    return false;
  } catch (error) {
    console.error(`❌ Failed to recover session for ${customerPhone}:`, error);
    return false;
  }
}
```

### Step 2: Integrate into processMessage

Modify `src/handlers/processMessage.ts`:

```typescript
import { recoverSessionFromDatabase } from '../state/sessionRecovery';

export async function processMessage(
  customerPhone: string,
  messageText: string,
  messageType: string,
  additionalData: Record<string, any> = {}
): Promise<void> {
  // Check if bot is globally disabled
  if (!getGlobalBotEnabled()) {
    console.log('🛑 Bot is globally disabled, skipping automation');
    return;
  }

  // NEW: Check if session exists, attempt recovery if not
  let session = getConversationSession(customerPhone);
  if (!session) {
    console.log(`⚠️ No session found in memory for ${customerPhone}, attempting recovery...`);
    const recovered = await recoverSessionFromDatabase(customerPhone);
    if (recovered) {
      session = getConversationSession(customerPhone);
      console.log(`✅ Session recovered for ${customerPhone}`);
    } else {
      console.log(`📝 No session to recover, treating as new conversation`);
    }
  }

  // Rest of the processMessage logic...
  // ... existing code ...
}
```

### Step 3: Test

1. Start a conversation with bot
2. Add items to cart
3. Restart server: `pm2 restart all`
4. Send another message
5. Bot should recover session and continue conversation ✅

## Long-Term Solution: Move to Redis

### Architecture

```
┌────────────────────────────────┐
│     Bot Message Handler        │
└───────────┬────────────────────┘
            │
            │ Read/Write Session
            ▼
┌────────────────────────────────┐
│          Redis Cache           │
│                                │
│  Key: session:{phone}          │
│  Value: {                      │
│    stage: "browsing_items",    │
│    orderType: "delivery",      │
│    selectedCategory: "...",    │
│    lastActivity: timestamp     │
│  }                             │
│  TTL: 24 hours                 │
└────────────────────────────────┘
```

### Implementation Steps

1. Create `src/state/sessionRedis.ts`
2. Replace in-memory Map with Redis calls
3. Add TTL for automatic session cleanup
4. Add session serialization/deserialization
5. Update all session access points
6. Test with multiple server instances

### Benefits

- ✅ Survives server restarts
- ✅ Shared across multiple bot instances
- ✅ Automatic cleanup with TTL
- ✅ Can view/debug sessions in Redis
- ✅ Production-ready architecture

## Testing Checklist

After implementing the fix:

- [ ] Customer sends message → Bot responds
- [ ] Customer adds item to cart
- [ ] Restart server: `pm2 restart all`
- [ ] Customer sends message → Bot remembers cart
- [ ] Customer completes order → Bot processes correctly
- [ ] Wait 30 minutes → Send message → Bot starts fresh (session expired)
- [ ] Multiple restaurants work independently
- [ ] Dashboard shows all messages correctly

## Related Issues

This fix also helps with:
- ✅ Multi-instance deployment (load balancing)
- ✅ Bot consistency across restarts
- ✅ Session timeout handling
- ✅ Debugging conversation state

## Files to Modify

1. `src/state/sessionRecovery.ts` - NEW: Session recovery logic
2. `src/handlers/processMessage.ts` - Add recovery call
3. `src/state/session.ts` - (Optional) Add Redis backend
4. `src/state/orders.ts` - (Optional) Add Redis backend
5. `src/state/bot.ts` - (Optional) Add Redis backend

## Related Documentation

- `DASHBOARD_CRITICAL_ARCHITECTURE_FIX.md` - Dashboard data persistence
- `ADMIN_BOT_REGISTRATION_GUIDE.md` - Multi-tenant bot setup

