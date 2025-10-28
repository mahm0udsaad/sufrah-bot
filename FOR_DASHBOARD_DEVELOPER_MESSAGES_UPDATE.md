# Dashboard Developer - Message Display Update

## What Changed

We've fixed two critical issues with message display in the dashboard:

### 1. Template Messages Now Show Readable Names
**Before**: `content:HX4b088aa4afe1428c50a6b12026317ece`  
**After**: `📋 new_order_notification` or `📋 Welcome Message Template`

### 2. Real-Time Message Updates Now Work
Outbound messages sent from the dashboard now appear immediately in the message list via WebSocket events.

## API Changes

### GET `/api/conversations/:conversationId/messages`

**New Fields in Response**:
```json
{
  "messages": [
    {
      "content": "📋 new_order_notification",  // ← NOW FORMATTED!
      "original_content": "HX4b088aa4afe1428c50a6b12026317ece",  // ← NEW: raw content
      "template_preview": {  // ← ENHANCED: full template data
        "sid": "HX4b...",
        "friendlyName": "new_order_notification",
        "language": "ar",
        "body": "مرحباً...",
        "buttons": []
      },
      "content_sid": "HX4b...",
      ...
    }
  ]
}
```

### POST `/api/conversations/:conversationId/messages`

**Response Format** (same as GET):
```json
{
  "success": true,
  "data": {
    "message": {
      "content": "Hello there",  // ← FORMATTED
      "original_content": "Hello there",  // ← NEW
      "message_type": "text",
      "messageType": "text",  // ← Both formats for compatibility
      "timestamp": "2025-10-28T20:18:00.000Z",
      ...
    }
  }
}
```

### WebSocket Events

**Event Type**: `message.sent`

**Payload Structure**:
```json
{
  "type": "message.sent",
  "message": {
    "id": "msg_123",
    "conversation_id": "conv_456",
    "conversationId": "conv_456",  // Both formats
    "content": "📋 new_order_notification",  // FORMATTED
    "original_content": "HX4b...",  // RAW
    "message_type": "template",
    "messageType": "template",  // Both formats
    "from_phone": "+966573610338",
    "fromPhone": "+966573610338",  // Both formats
    "to_phone": "+201157337829",
    "toPhone": "+201157337829",  // Both formats
    "direction": "OUT",
    "timestamp": "2025-10-28T20:18:00.000Z",
    "createdAt": "2025-10-28T20:18:00.000Z",
    "wa_sid": "SM...",
    "waSid": "SM...",  // Both formats
    "channel": "freeform",
    "is_from_customer": false,
    "isFromCustomer": false,  // Both formats
    "status": "sent",
    "template_preview": { ... },  // For templates
    "content_sid": "HX4b...",  // For templates
    "media_url": "https://...",  // For media
    "mediaUrl": "https://..."  // Both formats
  },
  "conversation": {
    "id": "conv_456",
    "isBotActive": false,
    "unreadCount": 0,
    "lastMessageAt": "2025-10-28T20:18:00.000Z"
  }
}
```

## Frontend Changes Needed

### 1. Use Formatted Content
**Change**: Simply display `message.content` directly - it's now formatted!

```javascript
// ✅ CORRECT - Just use content
<div className="message-text">{message.content}</div>

// ❌ OLD WAY - No longer needed
// <div>{message.content_sid ? 'Template Message' : message.content}</div>
```

### 2. Handle WebSocket Events
**Required**: Add handler for `message.sent` events to update the message list in real-time

```javascript
socket.on('message.sent', (data) => {
  // Add the new message to your state/UI
  addMessageToConversation(data.message.conversation_id, data.message);
  
  // Update conversation metadata
  updateConversation(data.conversation.id, {
    lastMessageAt: data.conversation.lastMessageAt,
    isBotActive: data.conversation.isBotActive,
    unreadCount: data.conversation.unreadCount,
  });
});
```

### 3. Optional: Enhanced Template Display
If you want to show more template details:

```javascript
function MessageContent({ message }) {
  // For templates, you can show the preview
  if (message.template_preview) {
    return (
      <div>
        <div className="template-name">{message.content}</div>
        {message.template_preview.body && (
          <div className="template-body">{message.template_preview.body}</div>
        )}
        {message.template_preview.buttons?.map(btn => (
          <button key={btn.id}>{btn.text}</button>
        ))}
      </div>
    );
  }
  
  // For media, content includes emoji and type
  if (message.mediaUrl) {
    return (
      <div>
        <img src={message.mediaUrl} alt={message.content} />
        <p>{message.content}</p>  {/* e.g., "🖼️ Image" */}
      </div>
    );
  }
  
  // For text, just show content
  return <div>{message.content}</div>;
}
```

## Content Formatting Examples

### Template Messages
| Type | content | original_content |
|------|---------|------------------|
| Welcome Template | `📋 welcome_message` | `HX4b088aa4afe1428c50a6b12026317ece` |
| Order Notification | `📋 new_order_notification` | `HX5c199bb5bge2539d61c7b23037428fdf` |
| Unknown Template | `📋 Template Message` | `HX...` |

### Media Messages
| Type | content | mediaUrl |
|------|---------|----------|
| Image with caption | `Product photo` | `https://...` |
| Image without caption | `🖼️ Image` | `https://...` |
| Video | `🎥 Video` | `https://...` |
| Document | `📄 Document` | `https://...` |

### Text Messages
| Type | content |
|------|---------|
| Regular text | `Hello there` |
| Arabic text | `مرحباً` |

## Backward Compatibility

✅ **All existing fields are preserved**  
✅ **Dual field names** (`content_sid` + `contentSid`, `message_type` + `messageType`, etc.)  
✅ **`original_content` added** for debugging/logging without breaking existing code

## Testing Checklist for Frontend

1. **Message List Display**
   - [ ] Template messages show friendly names (📋 icon)
   - [ ] Media messages show type icons (🖼️, 🎥, etc.)
   - [ ] Text messages display normally

2. **Sending Messages**
   - [ ] Stop bot for conversation
   - [ ] Send text message
   - [ ] Message appears immediately in list
   - [ ] No duplicate messages

3. **Real-Time Updates**
   - [ ] Open two browser tabs
   - [ ] Send message in tab 1
   - [ ] Message appears in tab 2 via WebSocket

4. **WebSocket Connection**
   - [ ] Events are received on correct channel
   - [ ] Message data includes all fields
   - [ ] Conversation updates work correctly

## Questions?

If you need:
- More details about the template_preview structure
- Examples of WebSocket event handling
- Help with specific frontend framework integration

Please refer to `DASHBOARD_MESSAGES_DISPLAY_FIX.md` for complete technical details.

