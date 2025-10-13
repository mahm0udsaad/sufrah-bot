# Plan for Bot Developer

This document outlines the backend implementation tasks for the `bun-whatsapp-bot` service to support the new features for the Sufrah Dashboard.

### 1. Refactor for Full Multi-Tenancy

The current bot service needs to be updated to handle multiple restaurants, each with its own Twilio configuration.

- **Update Database Schema**: Modify the `Restaurant` model in `prisma/schema.prisma` to include fields for `twilioAccountSid`, `twilioAuthToken`, and an `OnboardingStatus` enum (`PENDING_APPROVAL`, `ACTIVE`, `REJECTED`).
- **Run Migrations**: After updating the schema, generate and apply a new database migration.
- **Implement Dynamic Twilio Client**: Refactor the core logic in `index.ts` to remove the single global Twilio client. Instead, for each incoming message, identify the target restaurant based on the recipient's WhatsApp number, retrieve its credentials from the database, and instantiate a Twilio client with those credentials.
- **Scope Operations**: Ensure all bot operations (sending messages, fetching data, etc.) are scoped to the correct restaurant context.

### 2. Implement Live Agent Chat Takeover

A mechanism is needed to allow restaurant staff to pause the bot's automated responses.

- **Create Bot Toggling API**: Implement a new API endpoint, `POST /api/conversations/:id/toggle-bot`, that accepts a boolean `enabled` flag in the request body. This endpoint will update the `isBotActive` field for the specified conversation in the database.
- **Update Message Processor**: In the `processMessage` function in `index.ts`, add a check at the beginning to see if `isBotActive` is false for the current conversation. If it is, the function should exit immediately to prevent any automated messages from being sent.

### 3. Add Backend Support for Restaurant Onboarding

The bot service needs to manage the onboarding and verification status of new restaurants.

- **Implement Admin API Endpoints**: Create a new set of API endpoints for administrative purposes:
    - `GET /api/admin/restaurants?status=PENDING_APPROVAL`: Returns a list of all restaurants awaiting approval.
    - `POST /api/admin/restaurants/:id/approve`: Sets the specified restaurant's status to `ACTIVE`.
    - `POST /api/admin/restaurants/:id/reject`: Sets the specified restaurant's status to `REJECTED`.
- **Secure Endpoints**: Ensure that these new admin endpoints are protected and can only be accessed by authorized users.

### 4. Integrate Paymob for Payment Links

The bot needs to be able to generate and send payment links to customers for online orders.

- **Create Paymob Service**: Create a new service file at `src/services/paymob.ts` to encapsulate all interactions with the Paymob API. This service should handle authentication and the creation of payment links.
- **Add Configuration**: The new service will require environment variables such as `PAYMOB_API_KEY` and `PAYMOB_INTEGRATION_ID`.
- **Update Order Flow**: Modify the existing order submission logic. When a customer chooses to pay online, the bot should:
    1.  Call the new Paymob service with the order details to generate a payment link.
    2.  Send a WhatsApp message to the customer containing the generated link.
