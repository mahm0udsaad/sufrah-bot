# Plan for Dashboard Developer

This document outlines the required frontend and API integration tasks for the Sufrah Dashboard to support new features in the WhatsApp bot service.

### 1. Integrate Live Agent Chat Takeover

The dashboard needs a mechanism for restaurant staff to pause the bot and handle conversations manually.

- **Implement UI Toggle**: In the chat interface (`app/chats/page.tsx`), add a toggle switch or button for each conversation to enable or disable the bot.
- **Call Bot Toggling API**: When this toggle is used, the dashboard should make a `POST` request to the new bot service endpoint: `/api/conversations/:id/toggle-bot`. The body of the request should be `{ "enabled": boolean }`.
- **Visual Feedback**: The UI should clearly indicate whether the bot is active or has been paused for a given conversation.

### 2. Build the Restaurant Onboarding Interface

A new section is required for restaurant owners to sign up and configure their bot.

- **Create Onboarding Form**: Design a new page or modal where new restaurant owners can input their details, including their Twilio `Account SID` and `Auth Token`.
- **Submit Onboarding Data**: Upon submission, the dashboard's backend should securely send this data to the bot service.
- **Display Onboarding Status**: After submission, the restaurant's account should be shown as "Pending Approval."

### 3. Develop the Admin Approval Interface

A new interface is needed for administrators to manage restaurant onboarding requests.

- **Create Admin Page**: Build a new page, accessible only to admin users, that lists all restaurants with a "Pending Approval" status.
- **Fetch Pending Restaurants**: This page should call the new bot service endpoint `GET /api/admin/restaurants?status=PENDING_APPROVAL` to populate the list.
- **Implement Approval/Rejection**: For each restaurant in the list, provide "Approve" and "Reject" buttons that call the corresponding bot service endpoints:
    - `POST /api/admin/restaurants/:id/approve`
    - `POST /api/admin/restaurants/:id/reject`

### 4. Display Payment Information

To provide visibility into online payments, the dashboard's order view should be updated.

- **Add Payment Link Field**: When displaying order details, include a field to show the Paymob payment link that was sent to the customer.
- **Show Payment Status**: The dashboard should reflect the payment status of an order (e.g., "Paid," "Pending"). This will require a webhook endpoint on the dashboard's backend to receive status updates from Paymob.
- **Webhook Implementation**: Create a new API route on the dashboard's backend to handle incoming webhooks from Paymob. This route will update the order's payment status in the database.
