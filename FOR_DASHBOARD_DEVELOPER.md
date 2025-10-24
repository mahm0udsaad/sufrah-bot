# Message for Dashboard Developer

## ✅ Issue Fixed: `/api/catalog/items` Endpoint Added

The error you were seeing:
```
❌ API Error: /api/catalog/items SyntaxError: Unexpected token 'N', "Not Found" is not valid JSON
```

**Has been resolved!** The `/api/catalog/items` endpoint is now available.

---

## How to Use the Catalog Items Endpoint

### Endpoint
```
GET /api/catalog/items
```

### Authentication (Required)
```javascript
headers: {
  'Authorization': 'Bearer YOUR_PAT_TOKEN',
  'X-Restaurant-Id': 'YOUR_RESTAURANT_BOT_ID',
  'Accept-Language': 'ar' // or 'en'
}
```

### Query Parameters
- `categoryId` (optional) - Filter items by category ID. If omitted, returns all items from all categories.

### Example Requests

**Fetch all items:**
```javascript
const response = await fetch('http://localhost:3000/api/catalog/items', {
  headers: {
    'Authorization': 'Bearer YOUR_PAT',
    'X-Restaurant-Id': 'cmgm28wjo0001sa9oqd57vqko',
    'Accept-Language': 'ar'
  }
});

const { data } = await response.json();
console.log(`Total items: ${data.summary.totalItems}`);
console.log(`Available items: ${data.summary.availableItems}`);
```

**Fetch items from a specific category:**
```javascript
const response = await fetch('http://localhost:3000/api/catalog/items?categoryId=cat_abc123', {
  headers: {
    'Authorization': 'Bearer YOUR_PAT',
    'X-Restaurant-Id': 'cmgm28wjo0001sa9oqd57vqko',
    'Accept-Language': 'en'
  }
});

const { data } = await response.json();
```

### Response Format
```json
{
  "data": {
    "merchantId": "merchant_123",
    "items": [
      {
        "id": "item_1",
        "name": "Chicken Shawarma",
        "nameAr": "شاورما دجاج",
        "description": "Delicious chicken shawarma",
        "descriptionAr": "شاورما دجاج لذيذة",
        "price": 25.50,
        "priceAfter": null,
        "currency": "SAR",
        "imageUrl": "https://example.com/image.jpg",
        "available": true,
        "categoryId": "cat_1",
        "categoryName": "Main Dishes",
        "categoryNameAr": "الأطباق الرئيسية"
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
    "locale": "ar",
    "currency": "SAR",
    "timestamp": "2025-10-24T12:34:56.789Z"
  }
}
```

---

## Complete Catalog API Reference

All catalog endpoints now available:

| Endpoint | Purpose | Query Parameters |
|----------|---------|------------------|
| `GET /api/catalog/categories` | Get all categories with item counts | None |
| `GET /api/catalog/items` | Get all items or filter by category | `categoryId` (optional) |
| `GET /api/catalog/branches` | Get restaurant branches | None |
| `GET /api/catalog/sync-status` | Get catalog sync health status | None |

All endpoints require the same authentication headers:
- `Authorization: Bearer <PAT>`
- `X-Restaurant-Id: <bot-id>`
- `Accept-Language: en` or `ar` (optional, defaults to `en`)

---

## Notes

1. **X-API-Key is NOT required**: This header is only needed for admin endpoints. Regular dashboard endpoints use PAT authentication via the `Authorization` header.

2. **Performance**: When fetching all items (no `categoryId`), the endpoint fetches from all categories in parallel for better performance.

3. **Availability**: Items are marked as available if both delivery and receipt options are enabled.

4. **Localization**: The response automatically includes both English and Arabic names/descriptions where available.

5. **Error Handling**: 
   - `401`: Invalid or missing authentication
   - `404`: Restaurant not found
   - `400`: Restaurant not linked to Sufrah merchant
   - `500`: Failed to fetch from Sufrah API

---

## Backend Status

✅ Endpoint implemented  
✅ Authentication working  
✅ Localization support added  
✅ Documentation updated  

You should now be able to fetch catalog items without any errors!

