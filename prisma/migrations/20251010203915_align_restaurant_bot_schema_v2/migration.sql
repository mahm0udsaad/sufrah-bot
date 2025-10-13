/*
  Warnings:

  - A unique constraint covering the columns `[restaurant_id]` on the table `RestaurantBot` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "RestaurantBot" ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "restaurant_id" TEXT,
ADD COLUMN     "sender_sid" TEXT,
ADD COLUMN     "status" "BotStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "verification_sid" TEXT,
ADD COLUMN     "verified_at" TIMESTAMP(3),
ADD COLUMN     "waba_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantBot_restaurant_id_key" ON "RestaurantBot"("restaurant_id");

-- CreateIndex
CREATE INDEX "RestaurantBot_restaurant_id_idx" ON "RestaurantBot"("restaurant_id");

-- CreateIndex
CREATE INDEX "RestaurantBot_whatsappFrom_idx" ON "RestaurantBot"("whatsappFrom");

-- CreateIndex
CREATE INDEX "RestaurantBot_twilioSubaccountSid_idx" ON "RestaurantBot"("twilioSubaccountSid");

-- AddForeignKey
ALTER TABLE "RestaurantBot" ADD CONSTRAINT "RestaurantBot_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "RestaurantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
