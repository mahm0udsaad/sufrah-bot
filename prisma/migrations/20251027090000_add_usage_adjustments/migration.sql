-- Create UsageAdjustment table to track monthly top-ups/renewals
CREATE TABLE IF NOT EXISTS "UsageAdjustment" (
  "id" TEXT PRIMARY KEY,
  "restaurant_id" TEXT NOT NULL,
  "month" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "UsageAdjustment_restaurant_id_fkey"
    FOREIGN KEY ("restaurant_id") REFERENCES "RestaurantProfile"("id") ON DELETE CASCADE
);

-- Index for efficient lookup by restaurant and period
CREATE INDEX IF NOT EXISTS "UsageAdjustment_restaurant_period_idx"
  ON "UsageAdjustment" ("restaurant_id", "year", "month");


