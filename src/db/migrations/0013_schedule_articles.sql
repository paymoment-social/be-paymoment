ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "scheduled_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "articles_scheduled_at_idx" ON "articles" USING btree ("status", "scheduled_at");
