import { and, desc, eq, ilike, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { articles, hashtags, posts, users } from "../../db/schema";
import { decodeCursor, encodeCursor } from "../../lib/pagination";
import { hydratePost } from "../posts/posts.repository";
import { getUserProfile } from "../users/users.repository";
import { readTrendingHashtags } from "./trending";

type DiscoverType = "all" | "people" | "moments" | "articles" | "topics";

export async function searchDiscover(viewerId: string, query: string, type: DiscoverType, limit: number, cursorValue?: string) {
  const db = getDb();
  const searchTerm = query.trim().replace(/^[@#]/, "");
  const value = searchTerm ? `%${searchTerm.replace(/[%_\\]/g, "\\$&")}%` : "%";
  const hasQuery = searchTerm.length > 0;
  const cursor = decodeCursor(cursorValue);
  const searchVector = sql`to_tsvector('simple', coalesce(${posts.body}, '') || ' ' || coalesce(${articles.title}, '') || ' ' || coalesce(${articles.description}, '') || ' ' || coalesce(${articles.contentText}, '') || ' ' || coalesce(${users.displayName}, '') || ' ' || coalesce(${users.username}, '') || ' ' || coalesce((select string_agg(h.display_label, ' ') from post_hashtags ph inner join hashtags h on h.id = ph.hashtag_id where ph.post_id = ${posts.id}), ''))`;
  const hashtagMatch = sql`exists (select 1 from post_hashtags ph inner join hashtags h on h.id = ph.hashtag_id where ph.post_id = ${posts.id} and (h.slug ilike ${value} or h.display_label ilike ${value}))`;
  const postMatch = hasQuery ? or(sql`${searchVector} @@ websearch_to_tsquery('simple', ${searchTerm})`, ilike(users.displayName, value), ilike(users.username, value), hashtagMatch) : undefined;
  const postScore = hasQuery ? sql<number>`ts_rank(${searchVector}, websearch_to_tsquery('simple', ${searchTerm}))` : sql<number>`extract(epoch from ${posts.publishedAt})`;
  const personScore = hasQuery ? sql<number>`similarity(coalesce(${users.displayName}, '') || ' ' || coalesce(${users.username}, ''), ${searchTerm})` : sql<number>`extract(epoch from coalesce(${users.lastSeenAt}, ${users.createdAt}))`;
  const postCursor = cursor ? or(lt(postScore, cursor.score ?? Number.MAX_SAFE_INTEGER), and(eq(postScore, cursor.score ?? Number.MAX_SAFE_INTEGER), or(lt(posts.publishedAt, new Date(cursor.created_at)), and(eq(posts.publishedAt, new Date(cursor.created_at)), lt(posts.id, cursor.id))))) : undefined;
  const personCursor = cursor ? or(lt(personScore, cursor.score ?? Number.MAX_SAFE_INTEGER), and(eq(personScore, cursor.score ?? Number.MAX_SAFE_INTEGER), or(lt(users.createdAt, new Date(cursor.created_at)), and(eq(users.createdAt, new Date(cursor.created_at)), lt(users.id, cursor.id))))) : undefined;
  const topicCursor = cursor ? or(lt(hashtags.postCount, cursor.score ?? Number.MAX_SAFE_INTEGER), and(eq(hashtags.postCount, cursor.score ?? Number.MAX_SAFE_INTEGER), or(lt(hashtags.updatedAt, new Date(cursor.created_at)), and(eq(hashtags.updatedAt, new Date(cursor.created_at)), lt(hashtags.slug, cursor.id))))) : undefined;
  const needsPeople = type === "all" || type === "people";
  const needsMoments = type === "all" || type === "moments";
  const needsArticles = type === "all" || type === "articles";
  const needsTopics = type === "all" || type === "topics";
  const [peopleRows, momentRows, articleRows, topicRows] = await Promise.all([
    needsPeople ? db.select({ id: users.id, createdAt: users.createdAt, score: personScore }).from(users).where(and(eq(users.status, "active"), isNull(users.deletedAt), sql`not exists (select 1 from user_blocks b where (b.blocker_id = ${viewerId} and b.blocked_id = ${users.id}) or (b.blocker_id = ${users.id} and b.blocked_id = ${viewerId}))`, sql`not exists (select 1 from user_mutes m where m.muter_id = ${viewerId} and m.muted_id = ${users.id} and (m.expires_at is null or m.expires_at > now()))`, hasQuery ? or(ilike(users.displayName, value), ilike(users.username, value), sql`${personScore} > 0.15`) : undefined, type === "people" ? personCursor : undefined)).orderBy(desc(personScore), desc(users.createdAt), desc(users.id)).limit(limit + 1) : [],
    needsMoments ? db.select({ id: posts.id, publishedAt: posts.publishedAt, score: postScore }).from(posts).leftJoin(articles, eq(articles.postId, posts.id)).innerJoin(users, eq(users.id, posts.authorId)).where(and(eq(posts.status, "published"), isNull(posts.deletedAt), eq(posts.visibility, "public"), ne(posts.kind, "article"), sql`not exists (select 1 from user_blocks b where (b.blocker_id = ${viewerId} and b.blocked_id = ${posts.authorId}) or (b.blocker_id = ${posts.authorId} and b.blocked_id = ${viewerId}))`, sql`not exists (select 1 from user_mutes m where m.muter_id = ${viewerId} and m.muted_id = ${posts.authorId} and (m.expires_at is null or m.expires_at > now()))`, postMatch, type === "moments" ? postCursor : undefined)).orderBy(desc(postScore), desc(posts.publishedAt), desc(posts.id)).limit(limit + 1) : [],
    needsArticles ? db.select({ id: posts.id, publishedAt: posts.publishedAt, score: postScore }).from(posts).innerJoin(articles, eq(articles.postId, posts.id)).innerJoin(users, eq(users.id, posts.authorId)).where(and(eq(posts.status, "published"), isNull(posts.deletedAt), eq(posts.visibility, "public"), eq(posts.kind, "article"), eq(articles.status, "published"), sql`not exists (select 1 from user_blocks b where (b.blocker_id = ${viewerId} and b.blocked_id = ${posts.authorId}) or (b.blocker_id = ${posts.authorId} and b.blocked_id = ${viewerId}))`, sql`not exists (select 1 from user_mutes m where m.muter_id = ${viewerId} and m.muted_id = ${posts.authorId} and (m.expires_at is null or m.expires_at > now()))`, postMatch, type === "articles" ? postCursor : undefined)).orderBy(desc(postScore), desc(posts.publishedAt), desc(posts.id)).limit(limit + 1) : [],
    needsTopics ? db.select({ slug: hashtags.slug, label: hashtags.displayLabel, posts: hashtags.postCount, updatedAt: hashtags.updatedAt }).from(hashtags).where(and(or(ilike(hashtags.slug, value), ilike(hashtags.displayLabel, value)), type === "topics" ? topicCursor : undefined)).orderBy(desc(hashtags.postCount), desc(hashtags.updatedAt), desc(hashtags.slug)).limit(limit + 1) : [],
  ]);
  const peoplePage = peopleRows.slice(0, limit);
  const momentsPage = momentRows.slice(0, limit);
  const articlesPage = articleRows.slice(0, limit);
  const topicsPage = topicRows.slice(0, limit);
  const hasMore = type === "people" ? peopleRows.length > limit : type === "moments" ? momentRows.length > limit : type === "articles" ? articleRows.length > limit : type === "topics" ? topicRows.length > limit : false;
  const nextCursor = type === "people" && hasMore && peoplePage.at(-1)
    ? encodeCursor({ created_at: peoplePage.at(-1)!.createdAt.toISOString(), id: peoplePage.at(-1)!.id, score: Number(peoplePage.at(-1)!.score) })
    : type === "moments" && hasMore && momentsPage.at(-1)?.publishedAt
      ? encodeCursor({ created_at: momentsPage.at(-1)!.publishedAt!.toISOString(), id: momentsPage.at(-1)!.id, score: Number(momentsPage.at(-1)!.score) })
      : type === "articles" && hasMore && articlesPage.at(-1)?.publishedAt
        ? encodeCursor({ created_at: articlesPage.at(-1)!.publishedAt!.toISOString(), id: articlesPage.at(-1)!.id, score: Number(articlesPage.at(-1)!.score) })
        : type === "topics" && hasMore && topicsPage.at(-1)
          ? encodeCursor({ created_at: topicsPage.at(-1)!.updatedAt.toISOString(), id: topicsPage.at(-1)!.slug, score: Number(topicsPage.at(-1)!.posts) })
        : null;
  const [people, moments] = await Promise.all([
    Promise.all(peoplePage.map((row) => getUserProfile(row.id, viewerId))).then((values) => values.filter(Boolean)),
    Promise.all(momentsPage.map((row) => hydratePost(row.id, viewerId))).then((values) => values.filter(Boolean)),
  ]);
  const articlesData = await Promise.all(articlesPage.map((row) => hydratePost(row.id, viewerId))).then((values) => values.filter(Boolean));
  return { people, moments, articles: articlesData, topics: topicsPage.map((topic) => ({ label: topic.label, slug: topic.slug, posts: topic.posts })), nextCursor, hasMore };
}

export async function listDiscoverSuggestions(query: string, limit: number) {
  const searchTerm = query.trim().replace(/^[@#]/, "");
  const value = `%${searchTerm.replace(/[%_\\]/g, "\\$&")}%`;
  const [people, topics] = await Promise.all([
    getDb().select({ displayName: users.displayName, username: users.username }).from(users).where(and(eq(users.status, "active"), isNull(users.deletedAt), or(ilike(users.displayName, value), ilike(users.username, value), sql`similarity(coalesce(${users.displayName}, '') || ' ' || coalesce(${users.username}, ''), ${searchTerm}) > 0.2`))).orderBy(desc(sql`similarity(coalesce(${users.displayName}, '') || ' ' || coalesce(${users.username}, ''), ${searchTerm})`), desc(users.lastSeenAt)).limit(limit),
    getDb().select({ label: hashtags.displayLabel, slug: hashtags.slug }).from(hashtags).where(or(ilike(hashtags.slug, value), ilike(hashtags.displayLabel, value), sql`similarity(${hashtags.slug}, ${searchTerm}) > 0.2`)).orderBy(desc(hashtags.postCount), desc(hashtags.updatedAt)).limit(limit),
  ]);
  return [
    ...people.map((person) => ({ type: "person" as const, value: `@${person.username}`, label: `${person.displayName} (@${person.username})` })),
    ...topics.map((topic) => ({ type: "topic" as const, value: topic.label, label: topic.label })),
  ].slice(0, limit);
}

export async function listTrendingTopics(limit: number) {
  const cached = await readTrendingHashtags(limit);
  if (cached.length) {
    const rows = await getDb().select({ slug: hashtags.slug, label: hashtags.displayLabel, posts: hashtags.postCount }).from(hashtags).where(or(...cached.map((item) => eq(hashtags.slug, item.slug))));
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    return cached.map((item) => bySlug.get(item.slug)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  }
  return getDb().select({ slug: hashtags.slug, label: hashtags.displayLabel, posts: hashtags.postCount }).from(hashtags).orderBy(desc(hashtags.postCount), desc(hashtags.updatedAt)).limit(limit);
}
