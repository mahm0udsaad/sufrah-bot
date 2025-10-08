-- CreateEnum
CREATE TYPE "BotStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED', 'VERIFYING');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('active', 'closed');

-- CreateEnum
CREATE TYPE "MsgDir" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RestaurantBot" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsappFrom" TEXT NOT NULL,
    "twilioAccountSid" TEXT NOT NULL,
    "twilioAuthToken" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "twilioSubaccountSid" TEXT,
    "supportContact" TEXT,
    "paymentLink" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "max_messages_per_min" INTEGER NOT NULL DEFAULT 60,
    "max_messages_per_day" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantBot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "customer_wa" TEXT NOT NULL,
    "customer_name" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'active',
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "is_bot_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "direction" "MsgDir" NOT NULL,
    "wa_sid" TEXT,
    "message_type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "media_url" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "to_phone" TEXT NOT NULL,
    "from_phone" TEXT NOT NULL,
    "body" TEXT,
    "channel" TEXT,
    "template_sid" TEXT,
    "template_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "wa_sid" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "status_stage" INTEGER NOT NULL DEFAULT 0,
    "order_reference" TEXT,
    "order_type" TEXT,
    "payment_method" TEXT,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "delivery_address" TEXT,
    "delivery_lat" TEXT,
    "delivery_lng" TEXT,
    "branch_id" TEXT,
    "branch_name" TEXT,
    "branch_address" TEXT,
    "rating" INTEGER,
    "rating_comment" TEXT,
    "rated_at" TIMESTAMP(3),
    "rating_asked_at" TIMESTAMP(3),
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantProfile" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "whatsapp_number" TEXT,
    "logo_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "external_merchant_id" TEXT,

    CONSTRAINT "RestaurantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT,
    "request_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "headers" JSONB,
    "body" JSONB,
    "status_code" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "language" TEXT DEFAULT 'en',
    "header_type" TEXT,
    "header_content" TEXT,
    "body_text" TEXT NOT NULL,
    "footer_text" TEXT,
    "buttons" JSONB DEFAULT '[]',
    "variables" JSONB DEFAULT '[]',
    "status" TEXT DEFAULT 'draft',
    "whatsapp_template_id" TEXT,
    "usage_count" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageLog" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "is_verified" BOOLEAN DEFAULT false,
    "verification_code" TEXT,
    "verification_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantBot_whatsappFrom_key" ON "RestaurantBot"("whatsappFrom");

-- CreateIndex
CREATE INDEX "Conversation_customer_wa_idx" ON "Conversation"("customer_wa");

-- CreateIndex
CREATE INDEX "Conversation_restaurant_id_last_message_at_idx" ON "Conversation"("restaurant_id", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_restaurant_id_customer_wa_key" ON "Conversation"("restaurant_id", "customer_wa");

-- CreateIndex
CREATE UNIQUE INDEX "Message_wa_sid_key" ON "Message"("wa_sid");

-- CreateIndex
CREATE INDEX "Message_conversation_id_created_at_idx" ON "Message"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "Message_restaurant_id_created_at_idx" ON "Message"("restaurant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_wa_sid_key" ON "OutboundMessage"("wa_sid");

-- CreateIndex
CREATE INDEX "OutboundMessage_restaurant_id_created_at_idx" ON "OutboundMessage"("restaurant_id", "created_at");

-- CreateIndex
CREATE INDEX "OutboundMessage_restaurant_id_to_phone_idx" ON "OutboundMessage"("restaurant_id", "to_phone");

-- CreateIndex
CREATE INDEX "OutboundMessage_channel_idx" ON "OutboundMessage"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "Order_order_reference_key" ON "Order"("order_reference");

-- CreateIndex
CREATE INDEX "Order_restaurant_id_created_at_idx" ON "Order"("restaurant_id", "created_at");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantProfile_user_id_key" ON "RestaurantProfile"("user_id");

-- CreateIndex
CREATE INDEX "RestaurantProfile_user_id_idx" ON "RestaurantProfile"("user_id");

-- CreateIndex
CREATE INDEX "OrderItem_order_id_idx" ON "OrderItem"("order_id");

-- CreateIndex
CREATE INDEX "WebhookLog_restaurant_id_idx" ON "WebhookLog"("restaurant_id");

-- CreateIndex
CREATE INDEX "Template_status_idx" ON "Template"("status");

-- CreateIndex
CREATE INDEX "Template_user_id_idx" ON "Template"("user_id");

-- CreateIndex
CREATE INDEX "UsageLog_restaurant_id_idx" ON "UsageLog"("restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "RestaurantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "RestaurantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "RestaurantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "RestaurantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantProfile" ADD CONSTRAINT "RestaurantProfile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "RestaurantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "RestaurantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
