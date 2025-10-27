# List Picker Character Limit Fix

## Problem
The bot was experiencing three critical errors when displaying product lists:

1. **Error 21658 (Item Title)**: "Item cannot exceed 24 characters"
   - Twilio's list picker has a strict 24-character limit for item titles
   - Product names, category names, and branch names can exceed this limit

2. **Error 21658 (Item Description)**: "Item description cannot exceed 72 characters"
   - Twilio's list picker has a strict 72-character limit for item descriptions
   - Product descriptions combined with prices were exceeding this limit

3. **Error 21617**: "The concatenated message body exceeds the 1600 character limit"
   - Fallback text messages (when list picker creation fails) were too long
   - This happened when there were many items in a category

## Solution

### 1. Truncate List Picker Item Titles (Fixed in `src/workflows/quickReplies.ts`)

Added a `truncateItemTitle()` helper function that:
- Limits all list picker item **titles** to 24 characters max
- Adds "..." ellipsis when truncation occurs
- Applied to all list picker types:
  - Menu categories
  - Product items
  - Branches
  - Cart items (for removal)

**Example:**
```typescript
// Before: Could be 30+ characters
item: "سلطة الخضار المشكلة الطازجة"  // 31 characters

// After: Maximum 24 characters
item: truncateItemTitle(item.item) // "سلطة الخضار المشكلة..."  // 21 + 3 = 24 chars
```

### 2. Truncate List Picker Descriptions (Fixed in `src/workflows/quickReplies.ts`)

Added a `truncateDescription()` helper function that:
- Limits all list picker item **descriptions** to 72 characters max
- Adds "..." ellipsis when truncation occurs
- Applied to all list picker types:
  - Menu categories
  - Product items
  - Branches
  - Cart items (for removal)

**Example:**
```typescript
// Before: Could be 100+ characters
description: `${item.description} • ${item.price} ${item.currency || 'ر.س'}`

// After: Maximum 72 characters
description: truncateDescription(fullDescription) // "Long product description text... • 25.50 ر.س"
```

### 3. Split Long Fallback Messages (Fixed in `src/utils/text.ts` and `src/handlers/processMessage.ts`)

Added a `splitLongMessage()` function that:
- Splits messages longer than 1200 characters into multiple chunks
- Splits intelligently at line breaks to keep items together
- Keeps well under Twilio's 1600 character hard limit

Updated error handlers in three locations:
1. **Category list picker fallback** (`sendMenuCategories()`)
2. **Branch list picker fallback** (`sendBranchSelection()`)
3. **Items list picker fallback** (`showCategoryItems()`)

Each error handler now:
- Generates the fallback message
- Splits it into chunks if needed
- Sends multiple messages with a 300ms delay between them

**Example:**
```typescript
// Instead of sending one huge message that fails:
const itemsText = `🍽️ اختر طبقاً...\n${50+ items}...`; // 2000+ chars
await sendBotText(itemsText); // ❌ FAILS

// Now splits into multiple messages:
const chunks = splitLongMessage(itemsText); // ["chunk1", "chunk2"]
for (const chunk of chunks) {
  await sendBotText(chunk); // ✅ Each chunk < 1200 chars
  await delay(300); // Ensure proper order
}
```

## Files Modified

1. **`src/workflows/quickReplies.ts`**
   - Added `MAX_ITEM_TITLE_LENGTH` constant (24)
   - Added `MAX_DESCRIPTION_LENGTH` constant (72)
   - Added `truncateText()` base helper function
   - Added `truncateItemTitle()` helper function (24 chars)
   - Added `truncateDescription()` helper function (72 chars)
   - Updated all list picker creation functions to truncate both titles and descriptions

2. **`src/utils/text.ts`**
   - Added `MAX_MESSAGE_LENGTH` constant (1200)
   - Added `splitLongMessage()` function to split long messages

3. **`src/handlers/processMessage.ts`**
   - Imported `splitLongMessage` from utils
   - Updated 3 error handlers to split fallback messages

## Testing

Test with categories/products that have:
- Long descriptions (>72 characters)
- Many items (>10 per category causing multiple pages)
- Special characters and Arabic text

Expected behavior:
- ✅ List pickers display with truncated descriptions
- ✅ No more 21658 errors (description too long)
- ✅ Fallback messages split into multiple chunks if needed
- ✅ No more 21617 errors (message body too long)
- ✅ Messages arrive in correct order with proper delays

## Technical Details

### Character Limits
- **Twilio list picker item title**: 24 characters (hard limit)
- **Twilio list picker description**: 72 characters (hard limit)
- **WhatsApp message body**: 1600 characters (hard limit)
- **Our safe limit**: 1200 characters (buffer for safety)

### Pagination
- List pickers are already split into pages of 10 items max
- This helps keep fallback messages shorter
- Each page is sent with a 300ms delay

### Arabic Text Handling
- Character counting works correctly with Arabic text
- RTL (right-to-left) text displays properly
- Ellipsis (...) added at end even for RTL text

## Related Issues

This fix addresses the errors seen in production:
```
error: Twilio Content API error 400: {"code":21658,"message":"Item cannot exceed 24 characters"...}
error: Twilio Content API error 400: {"code":21658,"message":"Item description cannot exceed 72 characters"...}
error: The concatenated message body exceeds the 1600 character limit
```

All three errors are now prevented by truncating item titles, truncating descriptions, and splitting long messages.

