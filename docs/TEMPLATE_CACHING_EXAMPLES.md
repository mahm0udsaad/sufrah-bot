# Template Caching Implementation Examples

## Quick Start

The hash-based template caching system automatically reuses Twilio Content templates when the underlying data hasn't changed. This document provides practical examples.

## Basic Usage Pattern

```typescript
import {
  normalizeCategoryData,
  generateDataSignature,
  getHashSuffix,
  sanitizeIdForName,
} from '../utils/dataSignature';
import { getCachedContentSid } from '../workflows/cache';

// 1. Normalize your data
const normalizedData = normalizeCategoryData(categories, { page, merchantId });

// 2. Generate hash
const dataSignature = generateDataSignature(normalizedData);

// 3. Create friendly name
const safeMerchantId = sanitizeIdForName(merchantId);
const friendlyName = `food_list_${safeMerchantId}_${page}_${getHashSuffix(dataSignature)}`;

// 4. Get or create template
const contentSid = await getCachedContentSid(
  cacheKey,
  () => createTemplate(data), // Only called if cache miss
  displayText,
  {
    dataSignature,
    friendlyName,
    metadata: { /* context for debugging */ }
  }
);
```

## Example 1: Menu Categories

### Scenario
Restaurant has a menu with categories that rarely change. Multiple customers browse throughout the day.

### Implementation

```typescript
async function sendCategoriesMenu(
  client: TwilioClient,
  phoneNumber: string,
  categories: MenuCategory[],
  merchantId: string,
  page: number = 1
) {
  // Normalize data for consistent hashing
  const normalizedData = normalizeCategoryData(categories, { page, merchantId });
  const dataSignature = generateDataSignature(normalizedData);
  
  // Build cache key
  const cacheKey = `categories:${merchantId}:p${page}`;
  
  // Generate friendly name with hash suffix
  const safeMerchantId = sanitizeIdForName(merchantId);
  const friendlyName = `food_list_${safeMerchantId}_${page}_${getHashSuffix(dataSignature)}`;
  
  // Get cached or create new
  const contentSid = await getCachedContentSid(
    cacheKey,
    () => createFoodListPicker(TWILIO_CONTENT_AUTH, categories, page, { friendlyName }),
    'تصفح قائمتنا:',
    {
      dataSignature,
      friendlyName,
      metadata: {
        merchantId,
        page,
        itemCount: categories.length,
        categoryIds: categories.map(c => c.id),
      },
    }
  );
  
  // Send to customer
  await sendContentMessage(client, fromNumber, phoneNumber, contentSid, {
    variables: { "1": "اليوم" },
    logLabel: `Categories sent (page ${page})`
  });
}
```

### Cache Behavior

| Scenario | Data | Hash | Result |
|----------|------|------|--------|
| Customer 1 (10:00 AM) | [Burgers, Pizza, Salads] | `abc123` | Creates new template → `HX001` |
| Customer 2 (10:05 AM) | [Burgers, Pizza, Salads] | `abc123` | **Reuses** `HX001` ✅ |
| Customer 3 (10:10 AM) | [Burgers, Pizza, Salads] | `abc123` | **Reuses** `HX001` ✅ |
| Category renamed (2:00 PM) | [Burgers, Pizzas, Salads] | `def456` | Creates new template → `HX002` |
| Customer 4 (2:05 PM) | [Burgers, Pizzas, Salads] | `def456` | **Reuses** `HX002` ✅ |

**Result**: 5 customers, only 2 template creation API calls!

## Example 2: Branch Selection

### Scenario
Restaurant chain with multiple branches. Customers select nearest branch for pickup/delivery.

### Implementation

```typescript
async function sendBranchSelection(
  client: TwilioClient,
  phoneNumber: string,
  branches: BranchOption[],
  merchantId: string,
  page: number = 1
) {
  // Normalize branches (sorted by ID)
  const normalizedData = normalizeBranchData(branches, { page, merchantId });
  const dataSignature = generateDataSignature(normalizedData);
  
  const cacheKey = `branch_list:${merchantId}:p${page}`;
  const safeMerchantId = sanitizeIdForName(merchantId);
  const friendlyName = `branch_list_${safeMerchantId}_${page}_${getHashSuffix(dataSignature)}`;
  
  const branchSid = await getCachedContentSid(
    cacheKey,
    () => createBranchListPicker(TWILIO_CONTENT_AUTH, branches, page, { friendlyName }),
    'اختر الفرع الأقرب لك:',
    {
      dataSignature,
      friendlyName,
      metadata: {
        merchantId,
        page,
        branchCount: branches.length,
        branchIds: branches.map(b => b.id),
      },
    }
  );
  
  await sendContentMessage(client, fromNumber, phoneNumber, branchSid, {
    logLabel: `Branch list sent (page ${page})`
  });
}
```

### Data Change Example

```typescript
// Original branches
const branches = [
  { id: 'br_1', item: 'Downtown Branch', description: '123 Main St' },
  { id: 'br_2', item: 'Uptown Branch', description: '456 Oak Ave' }
];
// Hash: xyz789
// Template: HX100

// New branch added
const branchesUpdated = [
  { id: 'br_1', item: 'Downtown Branch', description: '123 Main St' },
  { id: 'br_2', item: 'Uptown Branch', description: '456 Oak Ave' },
  { id: 'br_3', item: 'Westside Branch', description: '789 Pine Rd' }
];
// Hash: xyz999 (different!)
// Template: HX101 (new template created automatically)
```

## Example 3: Items in Category

### Scenario
Customer browses items within a selected category. Items have prices that may change.

### Implementation

```typescript
async function sendCategoryItems(
  client: TwilioClient,
  phoneNumber: string,
  items: MenuItem[],
  category: MenuCategory,
  merchantId: string,
  page: number = 1
) {
  // Normalize items (includes prices)
  const normalizedData = normalizeItemData(items, {
    page,
    categoryId: category.id,
    merchantId,
  });
  const dataSignature = generateDataSignature(normalizedData);
  
  const cacheKey = `items_list:${merchantId}:${category.id}:p${page}`;
  const safeMerchantId = sanitizeIdForName(merchantId);
  const safeCategoryId = sanitizeIdForName(category.id);
  const friendlyName = `items_list_${safeMerchantId}_${safeCategoryId}_${page}_${getHashSuffix(dataSignature)}`;
  
  const contentSid = await getCachedContentSid(
    cacheKey,
    () => createItemsListPicker(
      TWILIO_CONTENT_AUTH,
      category.id,
      category.item,
      items,
      page,
      { friendlyName }
    ),
    `اختر طبقاً من ${category.item}:`,
    {
      dataSignature,
      friendlyName,
      metadata: {
        merchantId,
        categoryId: category.id,
        page,
        itemCount: items.length,
        itemIds: items.map(i => i.id),
      },
    }
  );
  
  await sendContentMessage(client, fromNumber, phoneNumber, contentSid, {
    variables: { '1': category.item },
    logLabel: `Items list sent (category: ${category.id}, page ${page})`
  });
}
```

### Price Change Detection

```typescript
// Morning menu
const items = [
  { id: 'item_1', item: 'Burger', price: 25.00, currency: 'SAR', description: 'Classic' },
  { id: 'item_2', item: 'Fries', price: 10.00, currency: 'SAR', description: 'Crispy' }
];
// Hash: aaa111
// Template: HX200 (created)

// Price increase in evening
const itemsEvening = [
  { id: 'item_1', item: 'Burger', price: 28.00, currency: 'SAR', description: 'Classic' },
  { id: 'item_2', item: 'Fries', price: 10.00, currency: 'SAR', description: 'Crispy' }
];
// Hash: aaa222 (different due to price change!)
// Template: HX201 (new template created with updated prices)
```

## Example 4: Quantity Selection

### Scenario
Customer selects an item and needs to specify quantity. Template should be reused for the same item across different customers.

### Implementation

```typescript
async function sendQuantityPrompt(
  client: TwilioClient,
  phoneNumber: string,
  itemName: string
) {
  // Normalize quantity data
  const normalizedData = normalizeQuantityData(itemName, MAX_ITEM_QUANTITY);
  const dataSignature = generateDataSignature(normalizedData);
  
  const cacheKey = `quantity_prompt:${sanitizeIdForName(itemName, 12)}`;
  
  const quantitySid = await getCachedContentSid(
    cacheKey,
    () => createQuantityQuickReply(TWILIO_CONTENT_AUTH, itemName, 1),
    `كم ترغب من ${itemName}؟`,
    {
      dataSignature,
      metadata: {
        itemName,
        maxQuantity: MAX_ITEM_QUANTITY,
      },
    }
  );
  
  await sendContentMessage(client, fromNumber, phoneNumber, quantitySid, {
    variables: { 1: itemName, 2: '1' },
    logLabel: 'Quantity prompt sent',
  });
}
```

### Reuse Across Customers

```typescript
// Customer A orders "Burger"
await sendQuantityPrompt(client, customerA, "Burger");
// Hash: ppp123
// Template: HX300 (created)

// Customer B orders "Burger" (same item)
await sendQuantityPrompt(client, customerB, "Burger");
// Hash: ppp123 (same!)
// Template: HX300 (reused) ✅

// Customer C orders "Pizza" (different item)
await sendQuantityPrompt(client, customerC, "Pizza");
// Hash: ppp456 (different)
// Template: HX301 (new template for Pizza)
```

## Example 5: Remove Item from Cart

### Scenario
Customer wants to remove an item from their cart. Template should be reused when cart contents match.

### Implementation

```typescript
async function sendRemoveItemList(
  client: TwilioClient,
  phoneNumber: string,
  cartItems: CartItem[],
  page: number = 1
) {
  // Prepare cart items for normalization
  const items = cartItems.map(item => ({
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    price: item.price,
    currency: item.currency,
  }));
  
  // Normalize and hash
  const normalizedData = normalizeRemoveItemData(items, { page });
  const dataSignature = generateDataSignature(normalizedData);
  
  const cacheKey = `remove_item:${phoneNumber}:p${page}`;
  
  const removeSid = await getCachedContentSid(
    cacheKey,
    () => createRemoveItemListQuickReply(TWILIO_CONTENT_AUTH, items, page),
    'اختر الصنف الذي ترغب في حذفه من السلة:',
    {
      dataSignature,
      metadata: {
        page,
        itemCount: items.length,
        itemIds: items.map(i => i.id),
      },
    }
  );
  
  await sendContentMessage(client, fromNumber, phoneNumber, removeSid, {
    logLabel: `Remove item list sent (page ${page})`
  });
}
```

### Cart Content Matching

```typescript
// Customer A's cart
const cartA = [
  { id: 'item_1', name: 'Burger', quantity: 2, price: 25, currency: 'SAR' },
  { id: 'item_2', name: 'Fries', quantity: 1, price: 10, currency: 'SAR' }
];
// Hash: rrr111
// Template: HX400 (created)

// Customer B has identical cart
const cartB = [
  { id: 'item_1', name: 'Burger', quantity: 2, price: 25, currency: 'SAR' },
  { id: 'item_2', name: 'Fries', quantity: 1, price: 10, currency: 'SAR' }
];
// Hash: rrr111 (same!)
// Template: HX400 (reused) ✅

// Customer C has different quantities
const cartC = [
  { id: 'item_1', name: 'Burger', quantity: 3, price: 25, currency: 'SAR' },
  { id: 'item_2', name: 'Fries', quantity: 1, price: 10, currency: 'SAR' }
];
// Hash: rrr222 (different due to quantity)
// Template: HX401 (new template)
```

## Testing Hash Consistency

### Verify Normalization

```typescript
import { normalizeCategoryData, generateDataSignature } from './utils/dataSignature';

// Test 1: Same data should produce same hash
const data1 = [
  { id: 'cat_2', item: 'Pizza', description: 'Hot pizzas' },
  { id: 'cat_1', item: 'Burgers', description: 'Tasty burgers' }
];

const data2 = [
  { id: 'cat_1', item: 'Burgers', description: 'Tasty burgers' },
  { id: 'cat_2', item: 'Pizza', description: 'Hot pizzas' }
];

const hash1 = generateDataSignature(normalizeCategoryData(data1, { merchantId: 'M1', page: 1 }));
const hash2 = generateDataSignature(normalizeCategoryData(data2, { merchantId: 'M1', page: 1 }));

console.assert(hash1 === hash2, 'Hashes should match despite different order');

// Test 2: Different data should produce different hash
const data3 = [
  { id: 'cat_1', item: 'Burgers', description: 'NEW DESCRIPTION' },
  { id: 'cat_2', item: 'Pizza', description: 'Hot pizzas' }
];

const hash3 = generateDataSignature(normalizeCategoryData(data3, { merchantId: 'M1', page: 1 }));

console.assert(hash1 !== hash3, 'Hashes should differ when data changes');
```

## Performance Metrics

### Expected Cache Hit Rates

| Scenario | Expected Hit Rate | Notes |
|----------|------------------|-------|
| Stable menu, many customers | 95%+ | Excellent caching |
| Daily menu updates | 60-80% | Good caching |
| Dynamic pricing | 40-60% | Moderate caching |
| Real-time inventory | 20-40% | Limited caching benefit |

### Cost Savings Example

**Restaurant with 1000 customers/day:**

| Without Caching | With Caching (90% hit rate) |
|----------------|----------------------------|
| 1000 customers × 5 templates = 5000 API calls | 500 initial + (100 × 5) = 1000 API calls |
| **Cost: $50/day** | **Cost: $10/day** |
| $1,500/month | **$300/month** |

**Savings: $1,200/month (80% reduction)**

## Debugging Tips

### 1. Log Hash Computations

```typescript
const normalizedData = normalizeCategoryData(categories, { page, merchantId });
console.log('Normalized:', JSON.stringify(normalizedData, null, 2));

const dataSignature = generateDataSignature(normalizedData);
console.log('Hash:', dataSignature);
```

### 2. Compare Hashes

```typescript
// Log both hashes when you expect a match but don't get one
console.log('Previous hash:', previousHash);
console.log('Current hash:', currentHash);
console.log('Match:', previousHash === currentHash);
```

### 3. Check Database

```sql
-- View all cached templates
SELECT key, data_hash, template_sid, friendly_name, last_used_at
FROM "ContentTemplateCache"
ORDER BY last_used_at DESC;

-- Find templates for specific merchant
SELECT *
FROM "ContentTemplateCache"
WHERE key LIKE '%merchant123%';

-- Count cache entries per template type
SELECT 
  SPLIT_PART(key, ':', 1) as template_type,
  COUNT(*) as count
FROM "ContentTemplateCache"
GROUP BY template_type;
```

## Next Steps

1. **Monitor cache hit rates** in production
2. **Set up periodic cleanup** of old templates (>90 days unused)
3. **Add alerts** for low cache hit rates (< 50%)
4. **Consider Redis** for distributed caching across instances
5. **Implement cache warming** on startup for common templates

## Related Documentation

- [TEMPLATE_HASH_CACHING.md](./TEMPLATE_HASH_CACHING.md) - Detailed technical documentation
- [src/utils/dataSignature.ts](../src/utils/dataSignature.ts) - Normalization functions
- [src/workflows/cache.ts](../src/workflows/cache.ts) - Cache orchestration logic

