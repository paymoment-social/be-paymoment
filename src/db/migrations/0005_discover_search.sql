CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "posts_body_fts_idx" ON "posts" USING gin (to_tsvector('simple', coalesce("body", '')));--> statement-breakpoint
CREATE INDEX "users_discover_trgm_idx" ON "users" USING gin ((coalesce("display_name", '') || ' ' || coalesce("username", '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "hashtags_slug_trgm_idx" ON "hashtags" USING gin ("slug" gin_trgm_ops);
