CREATE INDEX "articles_search_fts_idx" ON "articles" USING gin (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("description", '') || ' ' || coalesce("content_text", '')));
