ALTER TABLE "mcp_consents" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
ALTER TABLE "mcp_consents" ALTER COLUMN "expires_at" DROP DEFAULT;
ALTER TABLE "mcp_consents" ALTER COLUMN "expires_at" DROP NOT NULL;
ALTER TABLE "mcp_refresh_tokens" ALTER COLUMN "expires_at" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "mcp_consents_expires_at_idx" ON "mcp_consents" USING btree ("expires_at");
