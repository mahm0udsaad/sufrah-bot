-- CreateTable
CREATE TABLE "MonthlyUsage" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "conversation_count" INTEGER NOT NULL DEFAULT 0,
    "last_conversation_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationSession" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "customer_wa" TEXT NOT NULL,
    "session_start" TIMESTAMP(3) NOT NULL,
    "session_end" TIMESTAMP(3) NOT NULL,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyUsage_restaurant_id_year_month_idx" ON "MonthlyUsage"("restaurant_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyUsage_restaurant_id_month_year_key" ON "MonthlyUsage"("restaurant_id", "month", "year");

-- CreateIndex
CREATE INDEX "ConversationSession_restaurant_id_session_end_idx" ON "ConversationSession"("restaurant_id", "session_end");

-- CreateIndex
CREATE INDEX "ConversationSession_customer_wa_session_start_idx" ON "ConversationSession"("customer_wa", "session_start");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationSession_restaurant_id_customer_wa_session_start_key" ON "ConversationSession"("restaurant_id", "customer_wa", "session_start");

-- AddForeignKey
ALTER TABLE "MonthlyUsage" ADD CONSTRAINT "MonthlyUsage_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "RestaurantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "RestaurantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
