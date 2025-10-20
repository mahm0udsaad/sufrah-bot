# Chatbot User Interaction Tree

The tree below follows the customer journey inside WhatsApp: what the user sends, how the bot responds, and where the flow branches.

```
Start Conversation
│
├─ First Contact?
│  ├─ Yes → Bot sends welcome template (menu overview + quick start tips) → End of first touch
│  └─ No → Continue with returning-user logic
│
├─ Bot Globally Disabled?
│  ├─ Yes → Messages are logged only (no automated replies)
│  └─ No → Continue
│
├─ Synthetic Merchant (manual handling tenant)?
│  ├─ Yes → Bot sends concierge-style greeting and ends automation
│  └─ No → Bot automation active
│
├─ Special Keywords (any stage)
│  ├─ Ocean app links ("iphone"/"android") → Respond with download links
│  ├─ "contact_support" / "support" → Share support contact number
│  └─ Proceed with order flow triggers
│
├─ Order Flow Entry Points
│  ├─ "new_order" / 🆕 → Reset state + send order type quick reply
│  ├─ "browse_menu" / menu keywords → Send categories list picker
│  ├─ "track_order" → Return last known status or request order reference
│  ├─ "view_cart" → Show cart summary + cart options quick reply
│  ├─ "send_location" prompt → Remind user how to share location
│  └─ Free-form text → Attempt to match category/item names
│
├─ Pick Order Type
│  ├─ User taps "🛵 توصيل" or types delivery keywords
│  │    → State: delivery
│  │    → If location missing: send location request quick reply
│  │    → On location message: geocode + delivery check → thank user → send categories
│  └─ User taps "🏠 استلام" or types pickup keywords
│       → State: pickup
│       → Send branch list picker (or fallback text)
│       → User selects branch (picker or text search)
│            → Confirm branch + sync session → Send categories
│
├─ Browse Menu
│  ├─ Categories list picker (paged)
│  │    └─ User selects `cat_*` → Fetch items → Send items list picker
│  └─ Free-text category detection → Same as above
│
├─ Choose Item
│  ├─ Items list picker selection (`item_*`)
│  │    → Store pending item
│  │    → Send media (if available) + quantity quick reply
│  └─ Free-text item recognition → Same handling
│
├─ Set Quantity
│  ├─ Quick reply (`qty_1`, `qty_2`) → Call finalizeItemQuantity
│  ├─ "🔢 كمية أخرى" → Ask for numeric input (1–MAX)
│  └─ Numeric message → finalizeItemQuantity
│       → Add item to cart + sync session
│       → Send post-item quick reply (add more / checkout / view cart)
│
├─ Cart Management
│  ├─ "add_item" → Return to categories
│  ├─ "view_cart" → Show formatted cart + cart options quick reply
│  ├─ Remove item triggers →
│  │    ├─ Send removal list picker (paged) or ask for item name/index
│  │    └─ Upon selection → remove item → sync session → resend cart options
│  └─ Cart empty after removal → Suggest starting new order
│
├─ Checkout
│  ├─ User chooses "checkout" →
│  │    ├─ Guard location for delivery → re-request if missing
│  │    ├─ Guard branch for pickup → resend branch list if missing
│  │    └─ When ready → Sync session → Send order summary + payment options
│  └─ User cancels → Flow returns to cart/menu triggers
│
├─ Payment Selection
│  ├─ "pay_online" quick reply / keywords → submitExternalOrder (online)
│  │    ├─ On success → stop order simulation + reset order (preserve restaurant)
│  │    └─ On error → contextual error message (missing branch, API failure, etc.)
│  ├─ "pay_cash" quick reply / keywords → submitExternalOrder (cash)
│  │    └─ Same success + error handling patterns
│  └─ "confirm" keywords (manual confirmation) → submitExternalOrder
│
├─ After Submission
│  ├─ Successful → Bot resets order state, retains session for tracking, may send thanks
│  └─ Failure → Bot reports issue; user may retry or adjust cart
│
└─ Post-Order Support
   ├─ "track_order" again → Provide latest status/location summary
   ├─ "new_order" → Start fresh order flow (state reset)
   └─ Support keyword → Provide human handoff details
```

Use this tree as a reference when designing user stories, acceptance tests, or onboarding flows for new tenants.
