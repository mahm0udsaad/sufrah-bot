# Project Overview

This is a Next.js web application that serves as a dashboard for restaurants using the Sufrah platform. It allows restaurant owners to manage their orders, conversations with customers, and other restaurant-related settings. The application uses Next.js for the frontend and backend, Prisma as the ORM for interacting with a PostgreSQL database, and Twilio for communication features. The UI is built with Shadcn/UI and Radix UI components.

## Key Technologies

*   **Framework:** Next.js
*   **Database:** PostgreSQL with Prisma
*   **Authentication:** Cookie-based authentication
*   **UI:** Shadcn/UI, Radix UI, Tailwind CSS
*   **Communication:** Twilio

# Building and Running

To get the application running locally, you'll need to have Node.js and pnpm installed.

1.  **Install dependencies:**
    ```bash
    pnpm install
    ```

2.  **Set up the database:**
    *   Make sure you have a PostgreSQL database running.
    *   Create a `.env` file in the root of the project and add the `DATABASE_URL`:
        ```
        DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
        ```
    *   Run the database migrations:
        ```bash
        pnpm prisma migrate dev
        ```

3.  **Seed the database (optional):**
    ```bash
    pnpm db:seed
    ```

4.  **Run the development server:**
    ```bash
    pnpm dev
    ```

The application should now be running at http://localhost:3000.

## Other Commands

*   **Build for production:**
    ```bash
    pnpm build
    ```

*   **Run in production mode:**
    ```bash
    pnpm start
    ```

*   **Lint the code:**
    ```bash
    pnpm lint
    ```

# Development Conventions

*   **Code Style:** The project uses the default Next.js code style, with ESLint for linting.
*   **Database:** Database schema changes are managed with Prisma Migrate. To create a new migration, run `pnpm prisma migrate dev --name <migration-name>`.
*   **UI:** The UI is built with Shadcn/UI and Radix UI components. New components should be added to the `components/ui` directory.
