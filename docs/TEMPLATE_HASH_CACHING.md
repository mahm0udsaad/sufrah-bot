# Template Hash-Based Caching System

## Overview

The WhatsApp bot implements a deterministic hash-based caching system for Twilio Content templates. This system ensures that templates are only recreated when the underlying data actually changes, dramatically reducing API calls and improving performance.

## How It Works

### 1. Data Normalization

Before hashing, all data is normalized to ensure consistent hash generation regardless of API quirks:

- **Strip transient fields**: Remove timestamps, pagination tokens, and other fields that don't affect the rendered template
- **Sort arrays**: When order doesn't matter (e.g., categories, items), arrays are sorted by ID
- **Normalize null/undefined**: Convert undefined to null for consistency
- **Canonical JSON**: Convert to JSON with sorted keys

### 2. Hash Generation

The normalized data is passed through SHA-256 to generate a stable, deterministic hash:

```typescript
const normalizedData = normalizeCategoryData(categories, { page, merchantId });
const dataSignature = generateDataSignature(normalizedData);
```

### 3. Cache Lookup

The system checks three cache layers in order:

1. **In-memory cache**: Fast, process-level cache using Map
2. **Environment overrides**: Static SIDs from environment variables
3. **Database cache**: Persistent storage using PostgreSQL

The lookup uses a composite key: `(key, dataHash)`. If found, the existing SID is reused.

### 4. Template Creation

Only when no cached template matches the current data hash, a new template is created:

```typescript
const contentSid = await getCachedContentSid(
  cacheKey,
  () => createFoodListPicker(auth, categories, page, { friendlyName }),
  displayText,
  {
    dataSignature,
    friendlyName,
    metadata: { merchantId, page, itemCount, categoryIds }
  }
);
```

## Normalized Template Types

### 1. Categories List

**File**: `src/utils/dataSignature.ts` → `normalizeCategoryData()`

Normalizes menu categories for deterministic hashing:
- Sorts by category ID
- Includes: id, item, description
- Excludes: timestamps, internal metadata

**Usage**:
```typescript
const normalizedData = normalizeCategoryData(categories, { page: 1, merchantId });
const dataSignature = generateDataSignature(normalizedData);
```

### 2. Branch List

**File**: `src/utils/dataSignature.ts` → `normalizeBranchData()`

Normalizes branch data:
- Sorts by branch ID
- Includes: id, item, description
- Excludes: timestamps, coordinates (if not displayed)

**Usage**:
```typescript
const normalizedData = normalizeBranchData(branches, { page: 1, merchantId });
const dataSignature = generateDataSignature(normalizedData);
```

### 3. Items List

**File**: `src/utils/dataSignature.ts` → `normalizeItemData()`

Normalizes menu items:
- Sorts by item ID
- Includes: id, item, description, price, currency
- Excludes: availability status, stock levels (transient data)

**Usage**:
```typescript
const normalizedData = normalizeItemData(items, {
  page: 1,
  categoryId: 'cat_123',
  merchantId: 'merchant_456'
});
const dataSignature = generateDataSignature(normalizedData);
```

### 4. Quantity Prompt

**File**: `src/utils/dataSignature.ts` → `normalizeQuantityData()`

Normalizes quantity selection data:
- Includes: item name (trimmed), max quantity
- This ensures templates are reused across the same item

**Usage**:
```typescript
const normalizedData = normalizeQuantityData(itemName, MAX_ITEM_QUANTITY);
const dataSignature = generateDataSignature(normalizedData);
```

### 5. Remove Item List

**File**: `src/utils/dataSignature.ts` → `normalizeRemoveItemData()`

Normalizes cart items for removal:
- Sorts by item ID
- Includes: id, name, quantity, price, currency
- Ensures templates are reused when cart contents match

**Usage**:
```typescript
const normalizedData = normalizeRemoveItemData(cartItems, { page: 1 });
const dataSignature = generateDataSignature(normalizedData);
```

## Database Schema

The `ContentTemplateCache` table stores cached templates:

```prisma
model ContentTemplateCache {
  id           String   @id @default(cuid())
  key          String   // Template key (e.g., "categories:merchant123:p1")
  dataHash     String   // SHA-256 hash of normalized data
  templateSid  String   // Twilio Content SID
  friendlyName String?  // Human-readable name
  metadata     Json?    // Additional context
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  lastUsedAt   DateTime @default(now())

  @@unique([key, dataHash])
  @@index([templateSid])
}
```

### Key Design Decisions

1. **Composite unique constraint**: `(key, dataHash)` ensures we can store multiple versions of the same template type
2. **lastUsedAt tracking**: Enables cleanup of unused templates
3. **metadata field**: Stores context (merchant ID, page, item counts) for debugging and analytics

## Benefits

### 1. Reduced API Calls

Templates are only created when data actually changes:
- Same menu across multiple customers → reuse template
- Price update → new hash → new template
- Renamed category → new hash → new template

### 2. Cost Savings

Twilio charges per content creation API call. Hash-based caching can reduce calls by 90%+ in stable environments.

### 3. Performance

- In-memory cache: < 1ms lookup
- Database cache: ~5-10ms lookup
- Template creation: 200-500ms (avoided when cached)

### 4. Historical Tracking

Old templates remain in the database with their hashes, enabling:
- Audit trails
- Rollback capabilities
- Analytics on template evolution

## Implementation Examples

### Example 1: Category List with Data Changes

```typescript
// Day 1: Initial categories
const categories = [
  { id: 'cat_1', item: 'Burgers', description: 'Delicious burgers' },
  { id: 'cat_2', item: 'Pizza', description: 'Hot pizzas' }
];

// Normalized: { type: 'categories', merchantId: 'M1', page: 1, categories: [...sorted...] }
// Hash: abc123...
// → Creates new template, stores SID: HX1234567890abcdef

// Day 2: Same categories, different customer
// → Same hash: abc123...
// → Reuses SID: HX1234567890abcdef (no API call!)

// Day 3: Price change in "Burgers"
const categories = [
  { id: 'cat_1', item: 'Burgers', description: 'Delicious burgers - Now $5!' },
  { id: 'cat_2', item: 'Pizza', description: 'Hot pizzas' }
];

// Normalized: { type: 'categories', merchantId: 'M1', page: 1, categories: [...sorted...] }
// Hash: def456... (different!)
// → Creates new template, stores SID: HX9876543210fedcba
```

### Example 2: Quantity Prompt Reuse

```typescript
// Customer A selects "Burger"
const normalizedA = normalizeQuantityData('Burger', 20);
// Hash: xyz789...
// → Creates template with SID: HX111222333444

// Customer B selects "Burger" (same item)
const normalizedB = normalizeQuantityData('Burger', 20);
// Hash: xyz789... (same!)
// → Reuses SID: HX111222333444

// Customer C selects "Pizza" (different item)
const normalizedC = normalizeQuantityData('Pizza', 20);
// Hash: pqr321... (different!)
// → Creates new template with SID: HX555666777888
```

## Best Practices

### 1. Consistent Data Normalization

Always use the normalization functions from `src/utils/dataSignature.ts`:
```typescript
// ✅ Good
const normalized = normalizeCategoryData(categories, options);

// ❌ Bad - manual normalization may be inconsistent
const normalized = { categories: categories.map(c => ({ ...c })) };
```

### 2. Appropriate Cache Keys

Use descriptive, hierarchical keys:
```typescript
// ✅ Good
const cacheKey = `categories:${merchantId}:p${page}`;
const cacheKey = `items_list:${merchantId}:${categoryId}:p${page}`;

// ❌ Bad - too generic
const cacheKey = `categories`;
```

### 3. Include Relevant Context

Include in normalized data only what affects the template:
```typescript
// ✅ Good - includes data that changes template
normalizeItemData(items, { categoryId, merchantId, page });

// ❌ Bad - includes transient data
{ items, timestamp: Date.now(), sessionId: '...' }
```

### 4. Metadata for Debugging

Store useful metadata for debugging and analytics:
```typescript
{
  dataSignature,
  friendlyName,
  metadata: {
    merchantId,
    page,
    itemCount,
    categoryIds: categories.map(c => c.id)
  }
}
```

## Monitoring and Maintenance

### Cache Hit Rate

Monitor cache hit rates using the metrics in `src/services/templateCacheMetrics.ts`:
- Target: > 80% hit rate in production
- Low hit rate indicates frequently changing data

### Cleanup Strategy

Periodically clean up unused templates:
```sql
-- Find templates not used in 30 days
SELECT * FROM "ContentTemplateCache"
WHERE "last_used_at" < NOW() - INTERVAL '30 days';

-- Optional: Archive or delete
DELETE FROM "ContentTemplateCache"
WHERE "last_used_at" < NOW() - INTERVAL '90 days';
```

### Hash Collisions

SHA-256 collisions are astronomically rare (2^-256). If you suspect an issue:
1. Check normalization logic
2. Verify data is correctly sorted
3. Check for floating-point precision issues in prices

## Troubleshooting

### Template Not Being Reused

**Symptoms**: New templates created on every request even with same data

**Causes**:
1. Inconsistent data sorting
2. Transient fields not removed
3. Different data types (string vs number)
4. Floating-point precision differences

**Solution**:
```typescript
// Add logging to compare hashes
console.log('Normalized data:', JSON.stringify(normalizedData, null, 2));
console.log('Hash:', dataSignature);
```

### Cache Growing Too Large

**Symptoms**: Database or memory growing without bound

**Causes**:
1. Too many unique data variations
2. No cleanup strategy
3. Including dynamic/random data in cache key

**Solution**:
- Review normalization to remove volatile fields
- Implement periodic cleanup
- Use `lastUsedAt` to identify stale entries

## Future Enhancements

### 1. TTL (Time-to-Live)

Add expiration to cache entries:
```typescript
expiresAt: Date // Auto-cleanup after N days
```

### 2. Version Tracking

Track template versions explicitly:
```typescript
version: number // Increment on data changes
previousHash: string // Link to previous version
```

### 3. Cache Warming

Pre-populate cache with common templates on startup:
```typescript
await warmTemplateCache(commonCategories, commonBranches);
```

### 4. Distributed Caching

Use Redis for shared cache across multiple instances:
```typescript
const cached = await redis.get(`template:${key}:${hash}`);
```

## Related Files

- `src/utils/hash.ts` - Core hashing utilities
- `src/utils/dataSignature.ts` - Data normalization functions
- `src/db/contentTemplateCache.ts` - Database operations
- `src/workflows/cache.ts` - Cache orchestration logic
- `src/handlers/processMessage.ts` - Template usage examples
- `prisma/schema.prisma` - Database schema definition

## References

- [Twilio Content API Documentation](https://www.twilio.com/docs/content-api)
- [SHA-256 Hash Function](https://en.wikipedia.org/wiki/SHA-2)
- [Content Template Best Practices](https://www.twilio.com/docs/content-api/best-practices)

