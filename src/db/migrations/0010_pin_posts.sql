ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "pinned_at" timestamptz;
CREATE INDEX IF NOT EXISTS "posts_author_pinned_idx" ON "posts" ("author_id", "pinned_at" DESC NULLS LAST, "published_at" DESC, "id");
