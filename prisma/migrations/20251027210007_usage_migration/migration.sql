-- DropForeignKey
ALTER TABLE "public"."UsageAdjustment" DROP CONSTRAINT "UsageAdjustment_restaurant_id_fkey";

-- AlterTable
ALTER TABLE "UsageAdjustment" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "UsageAdjustment" ADD CONSTRAINT "UsageAdjustment_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "RestaurantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "UsageAdjustment_restaurant_period_idx" RENAME TO "UsageAdjustment_restaurant_id_year_month_idx";
