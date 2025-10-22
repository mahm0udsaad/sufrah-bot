-- CreateTable
CREATE TABLE "ContentTemplateCache" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data_hash" TEXT NOT NULL,
    "template_sid" TEXT NOT NULL,
    "friendly_name" TEXT,
    "metadata" JSONB DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentTemplateCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentTemplateCache_key_data_hash_key" ON "ContentTemplateCache"("key", "data_hash");

-- CreateIndex
CREATE INDEX "ContentTemplateCache_template_sid_idx" ON "ContentTemplateCache"("template_sid");
