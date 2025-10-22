## Send Media API — Dashboard Integration Guide

This guide explains how to call the Send Media API correctly from a dashboard so you never hit the error: {"error":"Message is required"}.

### What you’re trying to do
- **Goal**: Send WhatsApp media (images, documents, audio, video) to a customer.
- **Correct endpoint**: `POST /api/conversations/{conversationId}/send-media`

Where `conversationId` is the customer’s WhatsApp phone number in E.164 format (e.g. `+9665XXXXXXXX`).

> Important: Do NOT use a database conversation ID (e.g. `cmgz2r7me0003kjxloznq8uby`) in this path. The server expects a phone number and will normalize it.

Phone format and encoding:
- Always include the leading `+` (e.g., `+201157337829`).
- If your client URL-encodes the path, use `%2B201157337829` — the server decodes this back to `+201157337829`.
- Avoid stripping the `+`; sending just `201157337829` may break restaurant resolution and Twilio addressing.

---

### Required headers

Set both headers to authenticate the request:

```http
Authorization: Bearer <BOT_API_TOKEN>
X-Restaurant-Id: <restaurantId>   // Required when using a PAT-based token
Content-Type: application/json     // Or multipart/form-data
```

Notes:
- If your token is a Personal Access Token (PAT), `X-Restaurant-Id` is required.
- If you see 401/400 about restaurant or headers, verify both values.

---

### Request body (two supported formats)

You can send JSON or multipart form-data. Direct file uploads are NOT supported — upload the file elsewhere first and pass its public URL.

#### Option A) JSON (recommended)

```json
{
  "mediaUrl": "https://cdn.example.com/path/image.jpg",
  "mediaUrls": ["https://…/img1.jpg", "https://…/img2.jpg"],
  "caption": "Check out today’s special!",
  "mediaType": "image"  
}
```

Rules:
- Provide either `mediaUrl` (single) or `mediaUrls` (array). At least one media URL is required.
- `caption` is optional text sent with the media.
- `mediaType` is optional; supported values: `image` | `document` | `audio` | `video`. If omitted, it will be inferred from the first URL.

#### Option B) multipart/form-data

Fields:
- `mediaUrl`: string (single URL)
- `mediaUrls`: repeated field for multiple URLs (e.g. `mediaUrls[]=…`)
- `caption`: string (optional)
- `mediaType`: string (optional)

Example (curl):

```bash
curl -X POST "https://YOUR_BOT_DOMAIN/api/conversations/+966501234567/send-media" \
  -H "Authorization: Bearer $BOT_API_TOKEN" \
  -H "X-Restaurant-Id: $RESTAURANT_ID" \
  -F "mediaUrl=https://cdn.example.com/products/burger.jpg" \
  -F "caption=Our delicious burger special today!" \
  -F "mediaType=image"
```

Important: If you try to upload a file directly via `file`, the API will reject it with 422. Always provide a URL.

---

### Working examples

#### JSON + fetch

```ts
await fetch(
  `https://YOUR_BOT_DOMAIN/api/conversations/+966501234567/send-media`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BOT_API_TOKEN}`,
      'X-Restaurant-Id': RESTAURANT_ID,
    },
    body: JSON.stringify({
      mediaUrl: 'https://cdn.example.com/products/burger.jpg',
      caption: 'Our delicious burger special today! 🍔',
      mediaType: 'image',
    }),
  }
);
```

#### JSON + axios

```ts
import axios from 'axios';

await axios.post(
  'https://YOUR_BOT_DOMAIN/api/conversations/+966501234567/send-media',
  {
    mediaUrl: 'https://cdn.example.com/menu/today.pdf',
    caption: 'Today\'s menu',
    mediaType: 'document',
  },
  {
    headers: {
      Authorization: `Bearer ${BOT_API_TOKEN}`,
      'X-Restaurant-Id': RESTAURANT_ID,
    },
  }
);
```

---

### Common responses

- 200/202: Message accepted; returns the persisted message payload.
- 400: Validation error (e.g., missing `mediaUrl`/`mediaUrls`).
- 401: Unauthorized (bad/missing token).
- 404: Restaurant or conversation not found.
- 415: Unsupported content type (use JSON or multipart/form-data).
- 422: Direct file upload attempted; provide a `mediaUrl` instead.

---

### Avoiding the “Message is required” error

That error belongs to the text endpoint `POST /api/conversations/{conversationId}/send`, which requires a JSON body `{ "message": "..." }`.

If you see `{"error":"Message is required"}` while calling `/send-media`, it usually means one of the following:

1) You actually hit the text endpoint by mistake
- Double-check the path is exactly `/send-media` (no extra slashes, misspellings, or proxies rewriting the path).

2) You sent the wrong body shape or headers
- For media, provide `mediaUrl` or `mediaUrls` (not `message`).
- Set `Content-Type: application/json` (or `multipart/form-data`).

3) Proxy or SDK is normalizing the URL
- Confirm the final request URL on the wire (server/access logs) matches `/send-media`.

4) You’re mixing text and media semantics
- For media with a text caption, use the `caption` field on `/send-media`.
- Only use `/send` with `{ message: "..." }` when you want a pure text message.

Quick checklist:
- ✅ Path is `/api/conversations/{conversationId}/send-media`
- ✅ Body includes at least one `mediaUrl`
- ✅ Using `caption` (not `message`) for accompanying text
- ✅ `Authorization` and `X-Restaurant-Id` headers are present
- ✅ `Content-Type` is `application/json` or `multipart/form-data`

---

### Troubleshooting based on real logs

Use this section if you’re seeing errors like in the example logs.

- **Symptom**: `/send-media` responds 404, dashboard falls back to `/send`, which then returns `{"error":"Message is required"}`.
  - **Cause**: The target Bot API environment may not yet include the `/send-media` route, or the base URL/path is wrong (reverse proxy, missing `/api`, trailing slash rewrite).
  - **Fix**:
    - Verify the Bot API host and path: it must be `https://<BOT_HOST>/api/conversations/{phone}/send-media`.
    - Confirm the environment is updated to a version that includes the `/send-media` handler.
    - Do not fall back to `/send` for media; `/send` is for text only and requires `{ message: string }`.
    - Sanity check with curl directly against the Bot API environment (not through your dashboard):
      ```bash
      curl -i "https://YOUR_BOT_DOMAIN/api/conversations/%2B201157337829/send-media" \
        -H "Authorization: Bearer $BOT_API_TOKEN" \
        -H "X-Restaurant-Id: $RESTAURANT_ID" \
        -H "Content-Type: application/json" \
        -d '{"mediaUrl":"https://storage.sufrah.sa/uploads/<file>.jpg"}'
      ```

- **Symptom**: `{"error":"Restaurant context not found for conversation"}`
  - **Cause A (PAT)**: Using a Personal Access Token but missing the `X-Restaurant-Id` header.
  - **Cause B (Non-PAT)**: The server tried to infer the restaurant by phone but couldn’t resolve it.
  - **Cause C (Wrong environment/ID)**: The `X-Restaurant-Id` exists but doesn’t match a restaurant in the Bot API environment you’re calling.
  - **Fix**:
    - If using PAT: include `X-Restaurant-Id: <restaurant-uuid>`.
    - Ensure the `conversationId` is the customer’s phone (E.164, with `+`), not a DB conversation ID.
    - Confirm the restaurant exists in that environment and has a configured WhatsApp `from` number.
    - If you maintain separate staging/production stacks, use the restaurant ID from the same stack you’re calling.

- **Symptom**: You are sending `conversationId: cmgz2r7me0003kjxloznq8uby`
  - **Cause**: That looks like a database conversation ID. The `/send-media` endpoint expects a phone number.
  - **Fix**: Use the customer’s phone (e.g., `+966500000000`) as `conversationId`. If you only have the DB conversation ID, fetch the conversation first and use its `customerPhone` field.

Example correction:

```bash
curl -X POST "https://YOUR_BOT_DOMAIN/api/conversations/%2B966500235721/send-media" \
  -H "Authorization: Bearer $BOT_API_TOKEN" \
  -H "X-Restaurant-Id: $RESTAURANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "mediaUrl": "https://storage.sufrah.sa/uploads/<file>.jpg",
    "caption": "Hello",
    "mediaType": "image"
  }'
```

---

### Media tips

- Host files on HTTPS and ensure they’re publicly reachable by Twilio/WhatsApp.
- Keep sizes within WhatsApp limits (images ~5MB; other media up to ~16MB).
- Prefer stable, cacheable CDN URLs.

---

### Related endpoints

- Send text: `POST /api/conversations/{conversationId}/send` with `{ message: string }`.
- Toggle bot: `POST /api/conversations/{conversationId}/toggle-bot` with `{ enabled: boolean }`.

---

### Implementation references (for maintainers)

See the server handlers here:

```189:206:src/server/routes/api/conversations.ts
// Text endpoint validation
const body = (await req.json().catch(() => ({}))) as { message?: string };
const messageText = typeof body.message === 'string' ? body.message.trim() : '';
if (!messageText) {
  return jsonResponse({ error: 'Message is required' }, 400);
}
```

```269:336:src/server/routes/api/conversations.ts
// Media endpoint validation
// - supports JSON and multipart/form-data
// - requires at least one mediaUrl
// - optional caption and mediaType
```


