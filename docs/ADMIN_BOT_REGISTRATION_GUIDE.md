# Admin Bot Registration Guide

## Overview

This guide explains how to implement an admin page for registering new WhatsApp sender bots that are already configured in Twilio. The backend API endpoints are ready, and this document provides all the information needed to build the frontend interface.

## Purpose

Allow administrators to register multiple WhatsApp senders (phone numbers) that are already set up in Twilio into our bot system. Each sender becomes a separate bot instance that can handle conversations independently.

---

## Backend API Endpoints

All endpoints are prefixed with `/api/admin/bots`

### 1. List All Bots

**Endpoint:** `GET /api/admin/bots`

**Response:**
```json
[
  {
    "id": "clxxx123",
    "restaurantId": "rest_123",
    "name": "Sufrah Bot",
    "restaurantName": "Sufrah",
    "whatsappNumber": "whatsapp:+966508034010",
    "accountSid": "AC...",
    "subaccountSid": null,
    "authToken": "hidden",
    "wabaId": "777730705047590",
    "senderSid": "XE23c4f8b55966a1bfd101338f4c68b8cb",
    "verificationSid": null,
    "status": "ACTIVE",
    "verifiedAt": null,
    "errorMessage": null,
    "supportContact": "info@sufrah.sa",
    "paymentLink": "https://pay.sufrah.sa",
    "isActive": true,
    "maxMessagesPerMin": 60,
    "maxMessagesPerDay": 1000,
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-01-15T10:00:00.000Z",
    "restaurant": {
      "id": "rest_123",
      "name": "Sufrah Restaurant",
      "phone": "+966508034010"
    }
  }
]
```

### 2. Get Specific Bot

**Endpoint:** `GET /api/admin/bots/:botId`

**Response:** Same as single bot object above

### 3. Create New Bot

**Endpoint:** `POST /api/admin/bots`

**Request Body:**
```json
{
  "name": "Sufrah Bot",
  "restaurantName": "Sufrah",
  "whatsappNumber": "whatsapp:+966508034010",
  "accountSid": "AC1234567890abcdef1234567890abcd",
  "authToken": "your_twilio_auth_token",
  "subaccountSid": "AC...", // Optional
  "senderSid": "XE23c4f8b55966a1bfd101338f4c68b8cb",
  "wabaId": "777730705047590",
  "status": "ACTIVE", // Optional: PENDING, ACTIVE, FAILED, VERIFYING
  "restaurantId": null, // Optional: link to existing restaurant profile
  "supportContact": "info@sufrah.sa", // Optional
  "paymentLink": "https://pay.sufrah.sa", // Optional
  "maxMessagesPerMin": 60, // Optional, default: 60
  "maxMessagesPerDay": 1000 // Optional, default: 1000
}
```

**Required Fields:**
- `name` - Internal bot name (e.g., "Sufrah Bot")
- `restaurantName` - Display name of the restaurant
- `whatsappNumber` - WhatsApp number in format `whatsapp:+966...` or `+966...`
- `accountSid` - Twilio Account SID
- `authToken` - Twilio Auth Token

**Optional Fields:**
- `subaccountSid` - Twilio subaccount SID if using subaccounts
- `senderSid` - Twilio sender SID (from sender registration)
- `wabaId` - WhatsApp Business Account ID
- `status` - Bot status (default: ACTIVE)
- `restaurantId` - Link to existing restaurant profile
- `supportContact` - Support email/phone
- `paymentLink` - Payment URL for orders
- `maxMessagesPerMin` - Rate limit per minute
- `maxMessagesPerDay` - Rate limit per day

**Success Response (201):**
```json
{
  "id": "clxxx123",
  "name": "Sufrah Bot",
  ...
}
```

**Error Response (400):**
```json
{
  "error": "Missing required fields: name, restaurantName, whatsappNumber, accountSid, authToken"
}
```

**Error Response (409):**
```json
{
  "error": "Bot with WhatsApp number whatsapp:+966508034010 already exists"
}
```

### 4. Update Bot

**Endpoint:** `PUT /api/admin/bots/:botId`

**Request Body:** Same as create, but all fields are optional

**Success Response (200):**
```json
{
  "id": "clxxx123",
  "name": "Updated Bot Name",
  ...
}
```

### 5. Delete Bot

**Endpoint:** `DELETE /api/admin/bots/:botId`

**Success Response (200):**
```json
{
  "success": true,
  "message": "Bot deleted"
}
```

---

## New Senders to Register

Here are the two new senders that need to be registered:

### Sender 1: Sufrah
```json
{
  "name": "Sufrah Bot",
  "restaurantName": "Sufrah",
  "whatsappNumber": "whatsapp:+966508034010",
  "senderSid": "XE23c4f8b55966a1bfd101338f4c68b8cb",
  "wabaId": "777730705047590",
  "status": "ACTIVE",
  "supportContact": "info@sufrah.sa",
  "accountSid": "[ADMIN NEEDS TO PROVIDE]",
  "authToken": "[ADMIN NEEDS TO PROVIDE]"
}
```

**Additional Profile Info:**
- Email: info@sufrah.sa
- Website: https://sufrah.sa/
- Vertical: Restaurant
- Quality Rating: HIGH
- Webhook: https://bot.sufrah.sa/webhook

### Sender 2: Ocean Shawarma & Falafel Restaurant
```json
{
  "name": "Ocean Restaurant Bot",
  "restaurantName": "مطعم شاورما وفلافل أوشن",
  "whatsappNumber": "whatsapp:+966502045939",
  "senderSid": "XE803ebc75db963fdfa0e813d6f4f001f6",
  "wabaId": "777730705047590",
  "status": "ACTIVE",
  "accountSid": "[ADMIN NEEDS TO PROVIDE]",
  "authToken": "[ADMIN NEEDS TO PROVIDE]"
}
```

**Additional Profile Info:**
- Quality Rating: UNKNOWN
- No email or website provided

---

## UI Requirements

### Admin Page: Bot Management

Create a new admin page at `/admin/bots` with the following features:

#### 1. Bots List View
- Display all registered bots in a table or card grid
- Show for each bot:
  - Restaurant name
  - WhatsApp number
  - Status (ACTIVE/PENDING/FAILED/VERIFYING) with color coding
  - Sender SID
  - WABA ID
  - Created date
  - Action buttons: Edit, Delete, View Details
- Add "Register New Bot" button at the top

#### 2. Register New Bot Form
Modal or separate page with form fields:

**Basic Information:**
- Bot Name (text input) *required
- Restaurant Name (text input) *required
- WhatsApp Number (text input with format hint) *required
  - Show format: `whatsapp:+966508034010` or `+966508034010`

**Twilio Configuration:**
- Account SID (text input) *required
- Auth Token (password input) *required
- Subaccount SID (text input, optional)
- Sender SID (text input, optional)
- WABA ID (text input, optional)

**Settings:**
- Status (dropdown: PENDING, ACTIVE, FAILED, VERIFYING)
- Max Messages Per Minute (number input, default: 60)
- Max Messages Per Day (number input, default: 1000)
- Is Active (toggle switch, default: true)

**Optional Information:**
- Restaurant Profile (dropdown of existing restaurants, optional)
- Support Contact (text input)
- Payment Link (URL input)

**Actions:**
- Submit button
- Cancel button
- Form validation for required fields

#### 3. Edit Bot Form
Same as registration form, pre-populated with existing data

#### 4. Bot Details View
Display all bot information including:
- All fields from the bot record
- Linked restaurant profile (if any)
- Statistics: total conversations, messages sent/received
- Recent activity log

#### 5. Quick Registration Helper
Add a helper section at the top of the registration form with:
- "Quick Fill" buttons for the two new senders
- Clicking a button pre-fills the form with known data
- Admin only needs to add Account SID and Auth Token

Example buttons:
- 🍽️ Sufrah Restaurant
- 🥙 Ocean Shawarma & Falafel

---

## Implementation Steps

### Step 1: Create API Service
Create a service file for bot management API calls:

```typescript
// services/botApi.ts
const API_BASE = 'https://bot.sufrah.sa/api/admin/bots';

export interface Bot {
  id: string;
  name: string;
  restaurantName: string;
  whatsappNumber: string;
  accountSid: string;
  authToken: string;
  subaccountSid?: string | null;
  senderSid?: string | null;
  wabaId?: string | null;
  status: 'PENDING' | 'ACTIVE' | 'FAILED' | 'VERIFYING';
  restaurantId?: string | null;
  supportContact?: string | null;
  paymentLink?: string | null;
  isActive: boolean;
  maxMessagesPerMin: number;
  maxMessagesPerDay: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBotRequest {
  name: string;
  restaurantName: string;
  whatsappNumber: string;
  accountSid: string;
  authToken: string;
  subaccountSid?: string;
  senderSid?: string;
  wabaId?: string;
  status?: 'PENDING' | 'ACTIVE' | 'FAILED' | 'VERIFYING';
  restaurantId?: string;
  supportContact?: string;
  paymentLink?: string;
  maxMessagesPerMin?: number;
  maxMessagesPerDay?: number;
}

export async function listBots(): Promise<Bot[]> {
  const response = await fetch(API_BASE);
  if (!response.ok) throw new Error('Failed to fetch bots');
  return response.json();
}

export async function getBot(id: string): Promise<Bot> {
  const response = await fetch(`${API_BASE}/${id}`);
  if (!response.ok) throw new Error('Failed to fetch bot');
  return response.json();
}

export async function createBot(data: CreateBotRequest): Promise<Bot> {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create bot');
  }
  return response.json();
}

export async function updateBot(id: string, data: Partial<CreateBotRequest>): Promise<Bot> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update bot');
  }
  return response.json();
}

export async function deleteBot(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete bot');
}
```

### Step 2: Create Bot List Component
```typescript
// components/BotList.tsx
import { useEffect, useState } from 'react';
import { listBots, Bot } from '../services/botApi';

export function BotList() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBots();
  }, []);

  async function loadBots() {
    try {
      const data = await listBots();
      setBots(data);
    } catch (error) {
      console.error('Failed to load bots:', error);
      // Show error toast
    } finally {
      setLoading(false);
    }
  }

  // Render bot list with table or cards
  // Include edit/delete actions
}
```

### Step 3: Create Bot Form Component
```typescript
// components/BotForm.tsx
import { useState } from 'react';
import { createBot, updateBot, CreateBotRequest } from '../services/botApi';

interface Props {
  bot?: Bot; // If editing existing bot
  onSuccess: () => void;
  onCancel: () => void;
}

export function BotForm({ bot, onSuccess, onCancel }: Props) {
  const [formData, setFormData] = useState<CreateBotRequest>({
    name: bot?.name || '',
    restaurantName: bot?.restaurantName || '',
    whatsappNumber: bot?.whatsappNumber || '',
    accountSid: bot?.accountSid || '',
    authToken: bot?.authToken || '',
    // ... other fields
  });

  // Pre-fill data for known senders
  const KNOWN_SENDERS = {
    sufrah: {
      name: 'Sufrah Bot',
      restaurantName: 'Sufrah',
      whatsappNumber: 'whatsapp:+966508034010',
      senderSid: 'XE23c4f8b55966a1bfd101338f4c68b8cb',
      wabaId: '777730705047590',
      supportContact: 'info@sufrah.sa',
    },
    ocean: {
      name: 'Ocean Restaurant Bot',
      restaurantName: 'مطعم شاورما وفلافل أوشن',
      whatsappNumber: 'whatsapp:+966502045939',
      senderSid: 'XE803ebc75db963fdfa0e813d6f4f001f6',
      wabaId: '777730705047590',
    },
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (bot) {
        await updateBot(bot.id, formData);
      } else {
        await createBot(formData);
      }
      onSuccess();
    } catch (error) {
      console.error('Failed to save bot:', error);
      // Show error toast
    }
  }

  // Render form with all fields
  // Include quick-fill buttons for known senders
}
```

### Step 4: Create Bot Management Page
```typescript
// pages/admin/bots.tsx
export default function BotsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editingBot, setEditingBot] = useState<Bot | null>(null);

  return (
    <div>
      <header>
        <h1>Bot Management</h1>
        <button onClick={() => setShowForm(true)}>
          Register New Bot
        </button>
      </header>

      <BotList
        onEdit={(bot) => {
          setEditingBot(bot);
          setShowForm(true);
        }}
        onDelete={async (bot) => {
          if (confirm('Delete this bot?')) {
            await deleteBot(bot.id);
            // Reload list
          }
        }}
      />

      {showForm && (
        <Modal>
          <BotForm
            bot={editingBot}
            onSuccess={() => {
              setShowForm(false);
              setEditingBot(null);
              // Reload list
            }}
            onCancel={() => {
              setShowForm(false);
              setEditingBot(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
```

---

## Testing the Implementation

### 1. Test Bot Listing
```bash
curl -X GET https://bot.sufrah.sa/api/admin/bots
```

### 2. Test Creating Sufrah Bot
```bash
curl -X POST https://bot.sufrah.sa/api/admin/bots \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sufrah Bot",
    "restaurantName": "Sufrah",
    "whatsappNumber": "whatsapp:+966508034010",
    "senderSid": "XE23c4f8b55966a1bfd101338f4c68b8cb",
    "wabaId": "777730705047590",
    "accountSid": "YOUR_TWILIO_ACCOUNT_SID",
    "authToken": "YOUR_TWILIO_AUTH_TOKEN",
    "status": "ACTIVE",
    "supportContact": "info@sufrah.sa"
  }'
```

### 3. Test Creating Ocean Bot
```bash
curl -X POST https://bot.sufrah.sa/api/admin/bots \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ocean Restaurant Bot",
    "restaurantName": "مطعم شاورما وفلافل أوشن",
    "whatsappNumber": "whatsapp:+966502045939",
    "senderSid": "XE803ebc75db963fdfa0e813d6f4f001f6",
    "wabaId": "777730705047590",
    "accountSid": "YOUR_TWILIO_ACCOUNT_SID",
    "authToken": "YOUR_TWILIO_AUTH_TOKEN",
    "status": "ACTIVE"
  }'
```

---

## Security Considerations

1. **Authentication**: Add proper admin authentication before allowing access to these endpoints
2. **Authorization**: Ensure only authorized admins can create/edit/delete bots
3. **Auth Token Security**: 
   - Store auth tokens securely in the database
   - Don't expose them in list/get responses (mask them)
   - Use HTTPS for all API calls
4. **Input Validation**: The backend validates required fields and phone number format
5. **Rate Limiting**: Consider adding rate limits to prevent abuse

---

## Next Steps

1. ✅ Backend API endpoints are ready
2. ⏳ Implement the admin UI components
3. ⏳ Add authentication/authorization
4. ⏳ Test with the two new senders
5. ⏳ Deploy and verify webhook configuration
6. ⏳ Monitor bot status and logs

---

## Support

If you encounter any issues:
1. Check backend logs for error messages
2. Verify Twilio credentials are correct
3. Ensure WhatsApp numbers are properly formatted
4. Confirm the sender is registered in Twilio
5. Check webhook configuration in Twilio console

---

## FAQ

**Q: Can I register a bot without a sender SID?**
A: Yes, sender SID is optional. The bot will still work but may have limited features.

**Q: What's the difference between `name` and `restaurantName`?**
A: `name` is the internal identifier (e.g., "Sufrah Bot"), while `restaurantName` is displayed to customers (e.g., "Sufrah").

**Q: Can multiple bots share the same WABA ID?**
A: Yes, both new senders share WABA ID `777730705047590`.

**Q: What happens if I delete a bot?**
A: All conversations, messages, and orders associated with that bot will be cascade deleted. Use with caution.

**Q: How do I deactivate a bot without deleting it?**
A: Update the bot with `isActive: false` using the PUT endpoint.

