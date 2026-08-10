DROP INDEX "media_assets_cid_unique";--> statement-breakpoint
CREATE INDEX "media_assets_cid_idx" ON "media_assets" USING btree ("cid");