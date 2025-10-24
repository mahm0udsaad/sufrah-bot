# Catalog Items Endpoint Fix

## Problem

The dashboard developer was getting this error when calling `/api/catalog/items`:

```
❌ API Error: /api/catalog/items SyntaxError: Unexpected token 'N', "Not Found" is not valid JSON
```

**Root Cause**: The `/api/catalog/items` endpoint didn't exist in the backend. The catalog API only had:
- `/api/catalog/categories`
- `/api/catalog/branches`
- `/api/catalog/sync-status`

When the dashboard tried to fetch items, it hit the default 404 handler which returned plain text `"Not Found"` instead of JSON, causing a JSON parse error on the client.

## Solution

Added the missing `/api/catalog/items` endpoint to `src/server/routes/dashboard/catalog.ts`.

### Endpoint Details

**GET** `/api/catalog/items`

**Query Parameters:**
- `categoryId` (optional) - Filter items by specific category. If omitted, returns all items from all categories.

**Authentication:**
- Requires: `Authorization: Bearer <PAT>`
- Requires: `X-Restaurant-Id: <restaurantId>`

**Response Format:**
```json
{
  "data": {
    "merchantId": "merchant_123",
    "items": [
      {
        "id": "item_1",
        "name": "Item Name (English)",
        "nameAr": "اسم المنتج (عربي)",
        "description": "Description",
        "descriptionAr": "الوصف",
        "price": 25.50,
        "priceAfter": null,
        "currency": "SAR",
        "imageUrl": "https://...",
        "available": true,
        "categoryId": "cat_1",
        "categoryName": "Category Name",
        "categoryNameAr": "اسم الفئة"
      }
    ],
    "summary": {
      "totalItems": 150,
      "availableItems": 145,
      "unavailableItems": 5
    },
    "lastSync": "2025-10-24T12:34:56.789Z"
  },
  "meta": {
    "locale": "en",
    "currency": "SAR",
    "timestamp": "2025-10-24T12:34:56.789Z"
  }
}
```

### Implementation Features

1. **All Items or Filtered**: 
   - Without `categoryId`: Fetches all categories, then fetches items from each category in parallel
   - With `categoryId`: Fetches items only from the specified category

2. **Parallel Fetching**: When fetching all items, the endpoint fetches from all categories in parallel for better performance

3. **Error Handling**: If fetching items from a specific category fails, it logs the error but continues with other categories

4. **Localization**: Returns localized response with proper `meta` information including locale and currency

5. **Item Formatting**: Normalizes different field names from Sufrah API (handles both `nameEn`/`name`, `avatar`/`imageUrl`, etc.)

6. **Availability Logic**: Item is considered available if both delivery and receipt are available

## Files Updated

1. **`src/server/routes/dashboard/catalog.ts`**
   - Added import for `fetchCategoryProducts` from Sufrah API
   - Added new endpoint handler for `/api/catalog/items`

2. **`DASHBOARD_API_INTEGRATION_GUIDE.md`**
   - Added endpoint documentation in section 4.6 (Catalog & Templates)

## Usage Example

```typescript
// Fetch all items
const response = await dashboardFetch('/api/catalog/items', {
  locale: 'ar',
});

// Fetch items from specific category
const categoryItems = await dashboardFetch('/api/catalog/items', {
  query: { categoryId: 'cat_abc123' },
  locale: 'en',
});
```

## Testing

The dashboard developer should now be able to:

1. Call `/api/catalog/items` to get all catalog items
2. Call `/api/catalog/items?categoryId=cat_123` to get items from a specific category
3. Receive proper JSON responses with localized content
4. See item availability status
5. Access category information for each item

## Related Endpoints

The full catalog API now includes:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/catalog/categories` | Get all categories with item counts |
| `GET /api/catalog/items` | Get all items or filtered by category |
| `GET /api/catalog/branches` | Get restaurant branches |
| `GET /api/catalog/sync-status` | Get sync health status |

All endpoints follow the same authentication pattern and return localized responses.

