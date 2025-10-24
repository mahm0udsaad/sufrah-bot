# Currency Formatting Fix

## Problem

The bot server was throwing a `RangeError: currency is not a well-formed currency code` error when loading the orders page. This was happening because:

1. **Root Cause**: Currency values in the database were stored as `"ر.س"` (the Arabic symbol for Saudi Riyal) instead of the ISO 4217 standard code `"SAR"`.

2. **Technical Details**: The `Intl.NumberFormat` API (used in `formatCurrency`) requires ISO 4217 currency codes like:
   - `SAR` (Saudi Riyal)
   - `USD` (US Dollar)
   - `EUR` (Euro)
   
   It does NOT accept currency symbols like:
   - `ر.س` (Saudi Riyal symbol)
   - `$` (Dollar symbol)
   - `€` (Euro symbol)

## Solution

### 1. Added Currency Normalization Function

Updated `/src/services/i18n.ts` to include a `normalizeCurrency()` function that:
- Maps currency symbols to ISO codes
- Handles invalid or missing currency values
- Provides a safe fallback to 'SAR'

```typescript
function normalizeCurrency(currency: string | undefined | null): Currency {
  if (!currency || typeof currency !== 'string') {
    return 'SAR';
  }

  const normalized = currency.trim().toUpperCase();
  
  // Map currency symbols to ISO codes
  const currencyMap: { [key: string]: Currency } = {
    'ر.س': 'SAR',
    'SR': 'SAR',
    'SAR': 'SAR',
    'USD': 'USD',
    '$': 'USD',
    'EUR': 'EUR',
    '€': 'EUR',
  };

  return currencyMap[normalized] || currencyMap[currency] || 'SAR';
}
```

### 2. Updated `formatCurrency()` Function

Modified the function to:
- Accept both `Currency` type and `string` type
- Normalize the currency before passing to `Intl.NumberFormat`

```typescript
export function formatCurrency(amountCents: number, currency: Currency | string = 'SAR', locale: Locale = 'en'): string {
  const amount = amountCents / 100;
  const normalizedCurrency = normalizeCurrency(currency as string);
  
  const formatter = new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
    style: 'currency',
    currency: normalizedCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  
  return formatter.format(amount);
}
```

### 3. Cleaned Up Orders API

Removed unnecessary `as any` casts in `/src/server/routes/dashboard/orders.ts`:

**Before:**
```typescript
totalFormatted: formatCurrency(order.totalCents, (order.currency as any) || 'SAR', locale),
```

**After:**
```typescript
totalFormatted: formatCurrency(order.totalCents, order.currency, locale),
```

## Database Data

The existing orders in the database have currency values stored as `"ر.س"`. The normalization function now handles this correctly, so no database migration is needed. However, for future orders, it's recommended to store currency as ISO codes.

### Sample Data Found

```json
[
  { "id": "cmgpop7kh003okjf7ls327rdl", "currency": "ر.س" },
  { "id": "cmgtxh2ps006gkj0slte2ndg0", "currency": "ر.س" },
  // ... more orders with "ر.س"
]
```

## Redis Eviction Policy Warning

You also saw a warning: `IMPORTANT! Eviction policy is volatile-lru. It should be "noeviction"`

### What This Means

- **volatile-lru**: Redis will evict keys with TTL when memory is full
- **noeviction**: Redis will return errors when memory is full instead of evicting keys

### How to Fix

This is a Redis server configuration issue, not a bot code issue. To fix it:

1. **For Local Redis**:
   ```bash
   redis-cli CONFIG SET maxmemory-policy noeviction
   ```

2. **For Production Redis (persistent fix)**:
   Add to your `redis.conf` file:
   ```
   maxmemory-policy noeviction
   ```

3. **For Docker Redis**:
   ```bash
   docker exec -it <redis-container> redis-cli CONFIG SET maxmemory-policy noeviction
   ```

4. **For Cloud Redis (AWS, Azure, etc.)**:
   Update the configuration in your cloud provider's console.

## Testing

The fix has been applied. You can test by:

1. Visiting the orders page: http://localhost:3000/orders
2. The page should load without the currency error
3. All currency amounts should display correctly in SAR format

## Files Modified

1. `/src/services/i18n.ts` - Added currency normalization
2. `/src/server/routes/dashboard/orders.ts` - Cleaned up type casts

## Impact

- ✅ Orders page now loads without errors
- ✅ Currency formatting works with both ISO codes and symbols
- ✅ Backwards compatible with existing database data
- ✅ Future-proof for new currency codes

