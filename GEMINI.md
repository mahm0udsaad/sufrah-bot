# Project: WhatsApp Restaurant Bot

## Project Overview

This project is a WhatsApp-based chatbot for a restaurant, designed to handle food orders, customer interactions, and basic order tracking. It's built on a modern TypeScript stack, utilizing Bun as the runtime, Express for handling webhooks, and the Twilio API for WhatsApp messaging.

The bot engages users in a conversational flow, allowing them to:
-   Start a new order (for delivery or pickup).
-   Browse food categories and items.
-   Add/remove items from their cart.
-   Provide their location for delivery.
-   Choose a pickup branch.
-   Simulate payment (online or cash).
-   Track the status of their order.

The application is structured with a clear separation of concerns, with dedicated modules for configuration, state management, Twilio integration, and business logic (workflows). It maintains an in-memory state for conversations and orders, making it suitable for a single-instance deployment.

## Building and Running

### Prerequisites

-   [Bun](https://bun.sh/) installed.
-   A Twilio account with a WhatsApp-enabled number.
-   Environment variables configured (see below).

### Installation

To install the dependencies, run:

```bash
bun install
```

### Running the Application

To start the bot, run:

```bash
bun run index.ts
```

This will start the Express server, which listens for incoming webhooks from Twilio.

### Development Mode

For development, you can run the bot in watch mode to automatically restart on file changes:

```bash
bun run --watch index.ts
```

### Configuration

The application requires the following environment variables to be set. These can be placed in a `.env` file in the project root.

-   `PORT`: The port for the Express server (defaults to 3000).
-   `VERIFY_TOKEN`: A token to verify webhooks from Twilio.
-   `TWILIO_ACCOUNT_SID`: Your Twilio Account SID.
-   `TWILIO_AUTH_TOKEN`: Your Twilio Auth Token.
-   `TWILIO_WHATSAPP_FROM`: The WhatsApp-enabled phone number from your Twilio account.
-   `NOMINATIM_USER_AGENT`: A user agent for the Nominatim API (used for geocoding).
-   `PAYMENT_LINK`: A link to a payment gateway for online payments.
-   `SUPPORT_CONTACT`: A contact number for customer support.

## Development Conventions

### Code Style

The project uses TypeScript and follows standard formatting conventions. While there's no linter configured in the `package.json`, the code is well-structured and consistently formatted.

### State Management

The application's state (conversations and orders) is managed in-memory in the `src/state` directory. This is a simple approach that works for a single-instance deployment but would need to be replaced with a more robust solution (e.g., Redis, a database) for a multi-instance or production environment.

### Workflows

The core business logic of the bot is located in the `src/workflows` directory. This includes:
-   `menuData.ts`: Defines the restaurant's menu, categories, and branches.
-   `quickReplies.ts`: Creates the quick reply messages sent to the user.
-   `messages.ts`: Handles the recording of inbound messages.
-   `events.ts`: Manages WebSocket events for a real-time dashboard.

### Types

All major data structures are defined in `src/types/index.ts`. This provides a single source of truth for the application's data model.
