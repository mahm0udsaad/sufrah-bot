# Dashboard Messages Display Fix

## Problems Fixed

### Issue 1: Template Messages Show SIDs Instead of Readable Content
**Problem**: When template messages were sent (by bot or dashboard agent), the message list displayed cryptic template SIDs like `content:HX4b088aa4afe1428c50a6b12026317ece` instead of user-friendly text.

**Example**:
- Before: `content:HX4b088aa4afe1428c50a6b12026317ece`
- After: `📋 new_order_notification` or `📋 Welcome Message Template`

### Issue 2: Outbound Messages Not Appearing in Dashboard
**Problem**: When dashboard agents sent messages (with bot stopped), the messages were delivered successfully via WhatsApp but didn't appear in the dashboard's message list in real-time.

## Solutions Implemented

### 1. Enhanced Message Formatting (Backend)
**File**: `src/server/routes/dashboard/dashboardApi.ts`

#### GET `/api/conversations/:conversationId/messages`
Updated the message formatting logic to:

**For Template Messages**:
```typescript
// Check metadata for template information
if (metadata?.templateSid || metadata?.templatePreview) {
  const preview = metadata.templatePreview;
  
  if (preview) {
    // Use template's friendly name
    displayContent = `📋 ${preview.friendlyName || metadata.templateName || 'Template Message'}`;
    
    // Build complete template preview object
    templatePreview = {
      sid: preview.sid || metadata.templateSid,
      friendlyName: preview.friendlyName || metadata.templateName,
      language: preview.language || 'ar',
      body: preview.body || msg.content,
      contentType: preview.contentType || 'twilio/text',
      buttons: preview.buttons || [],
    };
  }
}
```

**For Media Messages**:
```typescript
if (msg.mediaUrl) {
  const mediaType = msg.messageType === 'image' ? '🖼️ Image' :
                    msg.messageType === 'video' ? '🎥 Video' :
                    msg.messageType === 'audio' ? '🎵 Audio' :
                    msg.messageType === 'document' ? '📄 Document' : '📎 Media';
  displayContent = msg.content || mediaType;
}
```

**Response Format**:
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "...",
        "conversation_id": "...",
        "content": "📋 new_order_notification",  // User-friendly display
        "original_content": "HX4b088aa4afe1428c50a6b12026317ece",  // Raw content for debugging
        "message_type": "template",
        "template_preview": {
          "sid": "HX4b088aa4afe1428c50a6b12026317ece",
          "friendlyName": "new_order_notification",
          "language": "ar",
          "body": "...",
          "buttons": []
        },
        "content_sid": "HX4b088aa4afe1428c50a6b12026317ece",
        "timestamp": "2025-10-28T20:18:00.000Z",
        "is_from_customer": false,
        ...
      }
    ]
  }
}
```

### 2. Fixed Real-Time Event Publishing
**Files**: 
- `src/server/routes/dashboard/dashboardApi.ts` (send message handlers)
- `src/redis/eventBus.ts` (event bus implementation)

#### POST `/api/conversations/:conversationId/messages`
Updated both text and media message handlers to:

1. **Format content before publishing events**:
```typescript
// Format content for display (same logic as GET endpoint)
const metadata = storedMessage.metadata as any;
let displayContent = storedMessage.content;

// Handle templates
if (metadata?.templateSid || metadata?.templatePreview) {
  const preview = metadata.templatePreview;
  displayContent = `📋 ${preview.friendlyName || metadata.templateName || 'Template Message'}`;
}

// Handle media
if (storedMessage.mediaUrl) {
  const mediaType = storedMessage.messageType === 'image' ? '🖼️ Image' : ...;
  displayContent = caption || mediaType;
}
```

2. **Publish comprehensive event payload**:
```typescript
await eventBus.publishMessage(restaurantId, {
  type: 'message.sent',
  message: {
    id: storedMessage.id,
    conversation_id: storedMessage.conversationId,
    conversationId: conversation.id,  // Both formats for compatibility
    content: displayContent,  // Formatted content
    original_content: storedMessage.content,  // Raw content
    message_type: storedMessage.messageType,
    messageType: storedMessage.messageType,  // Both formats
    from_phone: normalizedFrom,
    fromPhone: normalizedFrom,  // Both formats
    to_phone: normalizedTo,
    toPhone: normalizedTo,  // Both formats
    direction: 'OUT',
    timestamp: storedMessage.createdAt.toISOString(),
    createdAt: storedMessage.createdAt,
    wa_sid: storedMessage.waSid,
    waSid: storedMessage.waSid,  // Both formats
    channel: sendResult.channel,
    is_from_customer: false,
    isFromCustomer: false,  // Both formats
    status: 'sent',
    template_preview: templatePreview,  // Full template info
    content_sid: metadata?.templateSid,
    media_url: storedMessage.mediaUrl,  // For media messages
    mediaUrl: storedMessage.mediaUrl,
  },
  conversation: {
    id: updatedConversation.id,
    isBotActive: updatedConversation.isBotActive,
    unreadCount: updatedConversation.unreadCount,
    lastMessageAt: updatedConversation.lastMessageAt,
  },
});
```

3. **Return formatted response**:
```json
{
  "success": true,
  "data": {
    "message": {
      "id": "...",
      "conversation_id": "...",
      "content": "📋 new_order_notification",  // Formatted for display
      "original_content": "HX4b088aa4afe1428c50a6b12026317ece",
      "message_type": "template",
      "messageType": "template",
      "timestamp": "2025-10-28T20:18:00.000Z",
      "status": "sent",
      "direction": "OUT",
      "is_from_customer": false,
      "template_preview": { ... },
      "content_sid": "HX4b088aa4afe1428c50a6b12026317ece",
      ...
    }
  }
}
```

## Frontend Integration Guide

### WebSocket Event Handling

The frontend should listen for `message.sent` events and handle them to add messages to the UI:

```javascript
// Example WebSocket event handler
socket.on('message.sent', (data) => {
  const { message, conversation } = data;
  
  // Add message to the conversation's message list
  addMessageToConversation(message.conversation_id, {
    id: message.id,
    content: message.content,  // Already formatted!
    messageType: message.message_type || message.messageType,
    timestamp: message.timestamp,
    isFromCustomer: message.is_from_customer || message.isFromCustomer,
    status: message.status,
    mediaUrl: message.media_url || message.mediaUrl,
    templatePreview: message.template_preview,
  });
  
  // Update conversation metadata
  updateConversation(conversation.id, {
    lastMessageAt: conversation.lastMessageAt,
    unreadCount: conversation.unreadCount,
    isBotActive: conversation.isBotActive,
  });
});
```

### Message Display Logic

The frontend should display messages based on their type:

```javascript
function renderMessage(message) {
  // For text messages
  if (message.messageType === 'text') {
    return <TextMessage content={message.content} />;
  }
  
  // For template messages
  if (message.messageType === 'template' && message.templatePreview) {
    return (
      <TemplateMessage
        friendlyName={message.content}  // e.g., "📋 new_order_notification"
        preview={message.templatePreview}
      />
    );
  }
  
  // For media messages
  if (message.mediaUrl) {
    return (
      <MediaMessage
        type={message.messageType}
        url={message.mediaUrl}
        caption={message.content}  // e.g., "🖼️ Image" or actual caption
      />
    );
  }
  
  return <TextMessage content={message.content} />;
}
```

### API Response Handling

When sending a message, the frontend receives the formatted response immediately:

```javascript
async function sendMessage(conversationId, content) {
  const response = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, messageType: 'text' }),
  });
  
  const { data } = await response.json();
  
  // The message in data.message is already formatted
  // You can optionally add it immediately to the UI
  // (the WebSocket event will also arrive shortly)
  addMessageToUI(data.message);
  
  return data.message;
}
```

## Benefits

### User Experience
1. ✅ **Readable Templates**: Users see "📋 Welcome Message" instead of cryptic SIDs
2. ✅ **Immediate Feedback**: Messages appear instantly in the message list after sending
3. ✅ **Consistent Display**: Same formatting whether viewing history or receiving live updates
4. ✅ **Media Clarity**: Media messages show clear icons and types

### Developer Experience
1. ✅ **Dual Formats**: Both `snake_case` and `camelCase` fields for frontend compatibility
2. ✅ **Rich Metadata**: Full template preview data available for advanced rendering
3. ✅ **Debug Info**: `original_content` field preserved for troubleshooting
4. ✅ **Real-Time Events**: WebSocket events include all necessary data

## Testing Checklist

### Template Messages
- [ ] Send a message via bot → Verify template name shows instead of SID
- [ ] View message history → Confirm templates display user-friendly names
- [ ] Check template_preview object → Verify it contains friendlyName, body, buttons

### Dashboard Agent Messages
- [ ] Stop bot for a conversation
- [ ] Send a text message from dashboard
- [ ] Verify message appears immediately in message list
- [ ] Check message shows with correct timestamp and sender indicator
- [ ] Verify WebSocket event was published correctly

### Media Messages
- [ ] Send an image from dashboard
- [ ] Verify it shows "🖼️ Image" or caption
- [ ] Check mediaUrl is included in response and event
- [ ] Test with video, audio, document types

### Real-Time Updates
- [ ] Open dashboard in two browser tabs
- [ ] Send message in tab 1
- [ ] Verify it appears immediately in tab 2
- [ ] Check conversation updates (lastMessageAt, unreadCount)

## Redis Channel

Messages are published to:
```
ws:restaurant:{restaurantId}:messages
```

To monitor events during testing:
```bash
redis-cli
SUBSCRIBE ws:restaurant:cmh92786r0004saer5gfx81le:messages
```

## Notes

1. **Idempotency**: The message creation includes idempotency checks (see `DASHBOARD_MESSAGE_DUPLICATE_FIX.md`)
2. **Polling**: Text messages use brief polling (max 500ms) to retrieve the message created by `sendWhatsAppMessage()`
3. **Backward Compatibility**: Dual field names (`content_sid`/`contentSid`) ensure compatibility with existing frontend code
4. **Template Names**: The friendly name comes from the template's metadata stored during sending
5. **Icon Consistency**: Emojis (📋, 🖼️, 🎥, etc.) provide quick visual identification of message types

