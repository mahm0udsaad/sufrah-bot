-- AlterTable
ALTER TABLE "OutboundMessage" ALTER COLUMN "restaurant_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "OutboundMessage_to_phone_created_at_idx" ON "OutboundMessage"("to_phone", "created_at");
