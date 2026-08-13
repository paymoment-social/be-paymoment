CREATE UNIQUE INDEX IF NOT EXISTS "posts_author_single_pin_idx"
  ON "posts" ("author_id")
  WHERE "pinned_at" IS NOT NULL AND "deleted_at" IS NULL;
