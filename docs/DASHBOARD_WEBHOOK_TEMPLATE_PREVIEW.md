# Dashboard WebSocket Template Preview Integration Guide

## Overview

This guide explains the updated webhook/WebSocket data structure for displaying WhatsApp template messages in the restaurant dashboard. Previously, the system only sent the `contentSid` (template ID). Now, it sends complete template structure including body text, buttons, and styling information.

---

## Problem Statement

**Before:** Dashboard received only template SID like `HX1234567890abcdef`
- Restaurant owners couldn't see what the template looks like
- No visibility into buttons, text, or interactive elements
- Poor user experience

**After:** Dashboard receives complete template structure
- Full body text with variables replaced
- All buttons with their titles and types
- Template metadata for proper rendering
- Restaurant owners can see exactly what customers receive

---

## WebSocket Event Structure

### Message Event Types

The dashboard receives real-time events via WebSocket on channel:
```
ws:restaurant:{restaurantId}:messages
```

### Updated Message Event Schema

#### 1. Template Message Sent Event

```json
{
  "type": "message.sent",
  "message": {
    "id": "cm7abc123xyz",
    "conversationId": "cm7conv123",
    "content": "You have a new order made on Sufrah! 🎉",
    "messageType": "template",
    "direction": "OUT",
    "createdAt": "2025-10-20T10:30:00.000Z",
    "contentSid": "HX1234567890abcdef",
    "variables": {
      "1": "Restaurant Name",
      "2": "Customer Name"
    },
    "templatePreview": {
      "sid": "HX1234567890abcdef",
      "friendlyName": "order_notification_with_button",
      "language": "en",
      "body": "You have a new order made on Sufrah! 🎉",
      "contentType": "quick-reply",
      "buttons": [
        {
          "type": "QUICK_REPLY",
          "title": "View Order Details",
          "id": "view_order"
        }
      ]
    }
  }
}
```

#### 2. Regular Text Message Event (No Changes)

```json
{
  "type": "message.sent",
  "message": {
    "id": "cm7msg456xyz",
    "conversationId": "cm7conv123",
    "content": "Your order is ready for pickup!",
    "messageType": "text",
    "direction": "OUT",
    "createdAt": "2025-10-20T10:35:00.000Z"
  }
}
```

---

## Template Preview Object Structure

### TypeScript Interface

```typescript
interface TemplatePreview {
  // Twilio Content SID
  sid: string;
  
  // Human-readable template name
  friendlyName: string;
  
  // Template language code (e.g., "en", "ar")
  language: string;
  
  // Template body text with variables already replaced
  body: string;
  
  // Type of template content
  contentType: 'text' | 'quick-reply' | 'card' | 'list-picker';
  
  // Array of interactive buttons
  buttons: TemplateButton[];
}

interface TemplateButton {
  // Button type
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';
  
  // Button display text
  title: string;
  
  // Button identifier (for QUICK_REPLY)
  id?: string;
  
  // URL destination (for URL buttons)
  url?: string;
  
  // Phone number (for PHONE_NUMBER buttons)
  phone_number?: string;
}
```

---

## Implementation Guide for Dashboard Developer

### Step 1: Update Message Type Detection

```typescript
// Check if message is a template
const isTemplate = message.messageType === 'template' && message.templatePreview;

if (isTemplate) {
  // Render template preview
  renderTemplateMessage(message);
} else {
  // Render regular text message
  renderTextMessage(message);
}
```

### Step 2: Create Template Message Component

```typescript
function renderTemplateMessage(message: Message) {
  const { templatePreview } = message;
  
  return (
    <div className="template-message">
      {/* Template Header */}
      <div className="template-header">
        <span className="template-badge">WhatsApp Template</span>
        <span className="template-name">{templatePreview.friendlyName}</span>
      </div>
      
      {/* Template Body */}
      <div className="template-body">
        {templatePreview.body}
      </div>
      
      {/* Template Buttons */}
      {templatePreview.buttons.length > 0 && (
        <div className="template-buttons">
          {templatePreview.buttons.map((button, index) => (
            <TemplateButton key={index} button={button} />
          ))}
        </div>
      )}
      
      {/* Metadata */}
      <div className="template-footer">
        <span className="template-language">
          Language: {templatePreview.language}
        </span>
        <span className="template-type">
          Type: {templatePreview.contentType}
        </span>
      </div>
    </div>
  );
}
```

### Step 3: Style Template Buttons

```typescript
function TemplateButton({ button }: { button: TemplateButton }) {
  const getButtonIcon = (type: string) => {
    switch (type) {
      case 'QUICK_REPLY':
        return '💬';
      case 'URL':
        return '🔗';
      case 'PHONE_NUMBER':
        return '📞';
      case 'COPY_CODE':
        return '📋';
      default:
        return '▶️';
    }
  };
  
  return (
    <div className="template-button" data-type={button.type}>
      <span className="button-icon">{getButtonIcon(button.type)}</span>
      <span className="button-title">{button.title}</span>
    </div>
  );
}
```

### Step 4: Sample CSS Styling

```css
/* WhatsApp-like template message styling */
.template-message {
  background: #dcf8c6; /* WhatsApp green bubble */
  border-radius: 8px;
  padding: 12px;
  margin: 8px 0;
  max-width: 450px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.template-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 11px;
  color: #667781;
}

.template-badge {
  background: #25D366;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.template-body {
  font-size: 14px;
  line-height: 1.5;
  color: #111b21;
  margin: 8px 0;
  white-space: pre-wrap;
}

.template-buttons {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.1);
  padding-top: 8px;
}

.template-button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  background: white;
  border: 1px solid #d1d7db;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 14px;
  font-weight: 500;
  color: #027eb5;
}

.template-button:hover {
  background: #f0f2f5;
}

.button-icon {
  margin-right: 6px;
}

.template-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 10px;
  color: #8696a0;
}
```

---

## Backend Changes Summary

### What We Changed

1. **Created Template Preview Service** (`src/services/templatePreview.ts`)
   - Fetches template details from Twilio Content API
   - Caches template structure (30 min TTL)
   - Replaces variables with actual values
   - Parses buttons and interactive elements

2. **Updated Outbound Message Queue** (`src/redis/queue.ts`)
   - Fetches template preview when sending template messages
   - Includes `templatePreview` in WebSocket event payload
   - Adds `messageType: 'template'` for proper identification

3. **Updated WhatsApp Service** (`src/services/whatsapp.ts`)
   - Stores template preview in message metadata
   - Passes template structure to message records
   - Supports variable replacement in body text

### What Data Flows Where

```
┌─────────────────────┐
│  Twilio WhatsApp    │ ← Bot sends template with contentSid
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Twilio Content API  │ → Bot fetches template structure
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Template Preview   │ → Parse body, buttons, variables
│      Service        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Message Record    │ → Store in metadata
│    (PostgreSQL)     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Redis EventBus    │ → Publish to WebSocket channel
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Dashboard Client  │ → Render template preview
│    (WebSocket)      │
└─────────────────────┘
```

---

## Testing the Integration

### Step 1: Monitor WebSocket Events

```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://your-bot-server/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received event:', data);
  
  if (data.type === 'message.sent' && data.message.templatePreview) {
    console.log('Template Preview:', data.message.templatePreview);
  }
};
```

### Step 2: Trigger a Template Message

Send a message that falls outside the 24-hour WhatsApp window. The bot will automatically send a template with the "View Order Details" button.

### Step 3: Verify Data Structure

Check that you receive:
- ✅ `message.contentSid` - Template SID
- ✅ `message.templatePreview` - Complete preview object
- ✅ `message.templatePreview.body` - Text content
- ✅ `message.templatePreview.buttons` - Array of buttons
- ✅ `message.messageType === 'template'` - Type indicator

---

## Common Template Types

### 1. Quick Reply Template (Most Common)

Used for order notifications with action buttons.

```json
{
  "contentType": "quick-reply",
  "body": "You have a new order made on Sufrah! 🎉",
  "buttons": [
    {
      "type": "QUICK_REPLY",
      "title": "View Order Details",
      "id": "view_order"
    }
  ]
}
```

### 2. Text-Only Template

Used for simple notifications without buttons.

```json
{
  "contentType": "text",
  "body": "Your order has been delivered. Enjoy!",
  "buttons": []
}
```

### 3. Card Template

Used for rich media with image and buttons.

```json
{
  "contentType": "card",
  "body": "Special offer: 20% off on your next order!",
  "buttons": [
    {
      "type": "URL",
      "title": "View Menu",
      "url": "https://example.com/menu"
    }
  ]
}
```

---

## Backward Compatibility

The system maintains backward compatibility:

- **Old messages** without `templatePreview` will still display using `content` field
- **New messages** with `templatePreview` should use the enhanced rendering
- **Fallback logic**: If `templatePreview` is missing, display `content` as regular text

```typescript
function renderMessage(message: Message) {
  if (message.templatePreview && message.messageType === 'template') {
    return <TemplateMessage message={message} />;
  }
  return <TextMessage content={message.content} />;
}
```

---

## API Endpoints (Future Enhancement)

If you need to fetch template previews for historical messages:

```http
GET /api/templates/:contentSid/preview
Authorization: Bearer {token}

Response:
{
  "sid": "HX1234567890abcdef",
  "friendlyName": "order_notification",
  "body": "You have a new order!",
  "buttons": [...],
  "contentType": "quick-reply"
}
```

*(Currently not implemented - templates are fetched in real-time during message sending)*

---

## Troubleshooting

### Template Preview Not Showing

1. **Check WebSocket connection**
   - Verify dashboard is connected to Redis channel
   - Monitor console for connection errors

2. **Check message type**
   - Ensure `message.messageType === 'template'`
   - Verify `templatePreview` object exists

3. **Check template cache**
   - Template details are cached for 30 minutes
   - If Twilio template changed, cache may be stale

### Buttons Not Rendering

1. **Check button type**
   - Ensure button.type is one of: QUICK_REPLY, URL, PHONE_NUMBER, COPY_CODE
   - Verify button.title exists

2. **Check contentType**
   - Only `quick-reply` and `card` types have buttons
   - `text` and `list-picker` may not have buttons

### Variables Not Replaced

1. **Check variables object**
   - Verify `message.variables` is present
   - Variables are replaced server-side in `body` field

---

## Security Considerations

1. **Sanitize HTML** - Always escape template body text to prevent XSS
2. **Validate URLs** - Check button URLs before making them clickable
3. **Rate Limiting** - Template fetching is rate-limited on backend
4. **Authentication** - Ensure WebSocket connection is authenticated

---

## Performance Optimization

1. **Template Caching**
   - Backend caches templates for 30 minutes
   - Dashboard should cache rendered components

2. **Lazy Loading**
   - Load template styles only when needed
   - Defer non-visible message rendering

3. **WebSocket Efficiency**
   - Subscribe only to active restaurant channels
   - Unsubscribe when dashboard is closed

---

## Support & Questions

For questions or issues with this integration:

1. Check the backend logs for template fetch errors
2. Verify WebSocket events in browser DevTools
3. Review this documentation for implementation examples
4. Contact the backend team if template data is malformed

---

## Example: Complete React Component

```tsx
import React from 'react';
import './TemplateMessage.css';

interface TemplateMessageProps {
  message: {
    templatePreview: {
      sid: string;
      friendlyName: string;
      language: string;
      body: string;
      contentType: string;
      buttons: Array<{
        type: string;
        title: string;
        id?: string;
        url?: string;
      }>;
    };
    createdAt: string;
  };
}

export const TemplateMessage: React.FC<TemplateMessageProps> = ({ message }) => {
  const { templatePreview } = message;

  const handleButtonClick = (button: any) => {
    // Handle button interactions
    if (button.type === 'URL' && button.url) {
      window.open(button.url, '_blank');
    }
  };

  return (
    <div className="template-message-container">
      <div className="template-message">
        <div className="template-header">
          <span className="template-badge">📱 WhatsApp Template</span>
          <span className="template-name">{templatePreview.friendlyName}</span>
        </div>

        <div className="template-body">
          {templatePreview.body}
        </div>

        {templatePreview.buttons.length > 0 && (
          <div className="template-buttons">
            {templatePreview.buttons.map((button, idx) => (
              <button
                key={idx}
                className={`template-button button-${button.type.toLowerCase()}`}
                onClick={() => handleButtonClick(button)}
              >
                <span className="button-icon">
                  {button.type === 'QUICK_REPLY' && '💬'}
                  {button.type === 'URL' && '🔗'}
                  {button.type === 'PHONE_NUMBER' && '📞'}
                </span>
                <span className="button-title">{button.title}</span>
              </button>
            ))}
          </div>
        )}

        <div className="template-footer">
          <span className="template-meta">
            {templatePreview.language.toUpperCase()} • {templatePreview.contentType}
          </span>
          <span className="message-time">
            {new Date(message.createdAt).toLocaleTimeString()}
          </span>
        </div>
      </div>
    </div>
  );
};
```

---

## Summary Checklist for Dashboard Developer

- [ ] Update WebSocket event listener to handle `templatePreview` field
- [ ] Create React/Vue component for template message rendering
- [ ] Style template buttons to match WhatsApp appearance
- [ ] Add fallback for messages without `templatePreview`
- [ ] Test with different template types (quick-reply, text, card)
- [ ] Handle button interactions (URL, phone, quick replies)
- [ ] Add proper TypeScript types for template structure
- [ ] Optimize rendering performance for message lists
- [ ] Test backward compatibility with old messages
- [ ] Deploy and monitor for any rendering issues

---

**Last Updated:** October 20, 2025  
**Backend Version:** v2.0 (Template Preview Support)  
**Contact:** Backend Team

