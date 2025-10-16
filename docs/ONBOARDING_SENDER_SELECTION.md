## Onboarding Quick Start Update: Select Sender Dropdown

This guide replaces the old “Use Shared Number (Instant Setup)” with a dropdown that lets the user link one of our shared WhatsApp senders to their restaurant.

### What to build (Dashboard)
- **Replace** the Quick Start card with:
  - A dropdown: “Select a WhatsApp sender”
  - A primary button: “Connect”
- **Options**: items from our bot service where `isActive === true` and `restaurantId == null` (unassigned)
- **Labels**: `restaurantName — whatsappNumber` (e.g., `Sufrah — whatsapp:+966508034010`)
- Keep a secondary path: “Use your own number” (registrations POST to our service)

### API endpoints (Dashboard → Bot Service)
- **List senders**: `GET https://bot.sufrah.sa/api/admin/bots`
  - Client-side filter: `isActive === true && restaurantId == null`
- **Link sender**: `PUT https://bot.sufrah.sa/api/admin/bots/:botId`
  - Body: `{"restaurantId":"<CURRENT_RESTAURANT_ID>"}`
- Optional confirmation: `GET https://bot.sufrah.sa/api/admin/bots/:botId`
- Secondary flow (own number): `POST https://bot.sufrah.sa/api/admin/bots`

### Minimal UI example (React)
```tsx
function SenderLinker({ restaurantId }: { restaurantId: string }) {
  const [bots, setBots] = React.useState<any[]>([]);
  const [selectedId, setSelectedId] = React.useState<string>('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    fetch('https://bot.sufrah.sa/api/admin/bots')
      .then(r => r.json())
      .then((all) => setBots(all.filter((b: any) => b.isActive && !b.restaurantId)));
  }, []);

  const onConnect = async () => {
    if (!selectedId) return;
    setLoading(true);
    const res = await fetch(`https://bot.sufrah.sa/api/admin/bots/${selectedId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId }),
    });
    setLoading(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Failed to link sender. If it is linked elsewhere, unlink first.');
      return;
    }
    // refresh confirmation panel or navigate
  };

  return (
    <div>
      <label>Select a WhatsApp sender</label>
      <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
        <option value="" disabled>Select...</option>
        {bots.map((b) => (
          <option key={b.id} value={b.id}>
            {`${b.restaurantName} — ${b.whatsappNumber}`}
          </option>
        ))}
      </select>
      <button onClick={onConnect} disabled={!selectedId || loading}>
        {loading ? 'Connecting…' : 'Connect'}
      </button>
    </div>
  );
}
```

### cURL (for QA)
- List available:
```bash
curl -s 'https://bot.sufrah.sa/api/admin/bots' | jq '[ .[] | select(.isActive == true and .restaurantId == null) ]'
```
- Link:
```bash
curl -X PUT 'https://bot.sufrah.sa/api/admin/bots/BOT_ID' \
  -H 'Content-Type: application/json' \
  -d '{"restaurantId":"CURRENT_RESTAURANT_ID"}'
```
- Get details:
```bash
curl -s 'https://bot.sufrah.sa/api/admin/bots/BOT_ID'
```

### Edge cases
- **Already linked sender**: either hide from dropdown or disable with “Already linked”.
- **Unique link per restaurant**: if linking fails with a uniqueness/conflict error, prompt to:
  1) Unlink old bot (`PUT /api/admin/bots/:id` with `{"restaurantId": null}`)
  2) Link the new bot
- **Own number flow**: if the user chooses their own number, submit to `POST /api/admin/bots` with Twilio credentials.

### What we will do first (Backend/Ops)
- Seed shared senders as ACTIVE and unassigned (`restaurantId = null`). Example:
```bash
curl -X POST 'https://bot.sufrah.sa/api/admin/bots' \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"Sufrah Bot",
    "restaurantName":"Sufrah",
    "whatsappNumber":"whatsapp:+966508034010",
    "accountSid":"AC_xxx",
    "authToken":"xxx",
    "senderSid":"XE23c4f8b55966a1bfd101338f4c68b8cb",
    "wabaId":"777730705047590",
    "status":"ACTIVE"
  }'
```

### Why no backend change is needed
- Routing already maps inbound “To” number → `RestaurantBot`.
- Twilio client selection prefers credentials from `RestaurantBot` by `restaurantId`.
- Linking via the PUT call activates the selected sender for that restaurant automatically.

### QA checklist
- Sender dropdown shows at least one available shared number.
- Clicking Connect links the sender and updates confirmation panel.
- Inbound messages to that number appear in the restaurant’s dashboard.
- Outbound replies are sent from the linked number.
- Attempting to link an already-linked sender is correctly handled with a clear message.


