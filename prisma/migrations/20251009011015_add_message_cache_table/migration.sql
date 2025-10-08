-- CreateTable
CREATE TABLE "MessageCache" (
    "id" TEXT NOT NULL,
    "to_phone" TEXT NOT NULL,
    "from_phone" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "template_name" TEXT,
    "template_sid" TEXT,
    "outbound_message_id" TEXT,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "delivered_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageCache_to_phone_created_at_idx" ON "MessageCache"("to_phone", "created_at");

-- CreateIndex
CREATE INDEX "MessageCache_to_phone_delivered_idx" ON "MessageCache"("to_phone", "delivered");

-- CreateIndex
CREATE INDEX "MessageCache_expires_at_idx" ON "MessageCache"("expires_at");

