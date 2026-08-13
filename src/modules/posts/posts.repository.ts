import { and, count, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import {
  articles,
  bookmarks,
  follows,
  feedImpressions,
  hashtags,
  mediaAssets,
  pollOptions,
  polls,
  pollVotes,
  postHashtags,
  postLikes,
  postMedia,
  postMentions,
  postReplies,
  posts,
  postShares,
  postViews,
  replyLikes,
  replyMedia,
  replyMentions,
  reposts,
  rewardClaims,
  userBlocks,
  userMutes,
  users,
} from "../../db/schema";
import { AppError } from "../../lib/errors";
import { decodeCursor, encodeCursor } from "../../lib/pagination";
import { getUserProfile } from "../users/users.repository";
import type { CreateArticleInput, CreatePostInput, CreateReplyInput, UpdateArticleInput, UpdatePostInput } from "./posts.schemas";
import { articlePlainText, extractTokens, sanitizeArticleHtml } from "./content";
import { paginateFeedCandidates } from "./feed-pagination";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function syncTokens(tx: Tx, postId: string, body: string) {
  const tokens = extractTokens(body);
  const oldHashtags = await tx.select({ id: postHashtags.hashtagId }).from(postHashtags).where(eq(postHashtags.postId, postId));
  await tx.delete(postHashtags).where(eq(postHashtags.postId, postId));
  await tx.delete(postMentions).where(eq(postMentions.postId, postId));
  if (oldHashtags.length) await tx.update(hashtags).set({ postCount: sql`greatest(${hashtags.postCount} - 1, 0)`, updatedAt: new Date() }).where(inArray(hashtags.id, oldHashtags.map((row) => row.id)));

  if (tokens.mentions.length) {
    const mentioned = await tx.select({ id: users.id }).from(users).where(and(inArray(users.usernameNormalized, tokens.mentions), eq(users.status, "active"), isNull(users.deletedAt)));
    if (mentioned.length) await tx.insert(postMentions).values(mentioned.map((user) => ({ postId, mentionedUserId: user.id }))).onConflictDoNothing();
  }
  for (const slug of tokens.hashtags) {
    const [tag] = await tx.insert(hashtags).values({ slug, displayLabel: `#${slug}` }).onConflictDoUpdate({ target: hashtags.slug, set: { updatedAt: new Date() } }).returning({ id: hashtags.id });
    if (!tag) continue;
    await tx.insert(postHashtags).values({ postId, hashtagId: tag.id }).onConflictDoNothing();
    await tx.update(hashtags).set({ postCount: sql`${hashtags.postCount} + 1`, updatedAt: new Date() }).where(eq(hashtags.id, tag.id));
  }
}

async function attachPostMedia(tx: Tx, ownerId: string, postId: string, ids: string[], purpose: "post" | "article") {
  if (!ids.length) return;
  const assets = await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(and(
    inArray(mediaAssets.id, ids), eq(mediaAssets.ownerId, ownerId), eq(mediaAssets.status, "ready"), eq(mediaAssets.purpose, purpose), isNull(mediaAssets.attachedAt), isNull(mediaAssets.deletedAt),
  ));
  if (assets.length !== ids.length) throw new AppError(422, "VALIDATION_ERROR", "One or more media assets are unavailable or invalid.", { media_asset_ids: "Upload ready media owned by your account." });
  await tx.insert(postMedia).values(ids.map((mediaAssetId, position) => ({ postId, mediaAssetId, position })));
  await tx.update(mediaAssets).set({ attachedAt: new Date(), expiresAt: null, updatedAt: new Date() }).where(inArray(mediaAssets.id, ids));
}

async function attachReplyMedia(tx: Tx, ownerId: string, replyId: string, ids: string[]) {
  if (!ids.length) return;
  const assets = await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(and(
    inArray(mediaAssets.id, ids), eq(mediaAssets.ownerId, ownerId), eq(mediaAssets.status, "ready"), eq(mediaAssets.purpose, "reply"), isNull(mediaAssets.attachedAt), isNull(mediaAssets.deletedAt),
  ));
  if (assets.length !== ids.length) throw new AppError(422, "VALIDATION_ERROR", "The reply media asset is unavailable or invalid.", { media_asset_ids: "Upload ready reply media owned by your account." });
  await tx.insert(replyMedia).values(ids.map((mediaAssetId, position) => ({ replyId, mediaAssetId, position })));
  await tx.update(mediaAssets).set({ attachedAt: new Date(), expiresAt: null, updatedAt: new Date() }).where(inArray(mediaAssets.id, ids));
}

export async function createPost(authorId: string, input: CreatePostInput, actorType: "human" | "mcp_agent" = "human") {
  return getDb().transaction(async (tx) => {
    if (input.quoted_post_id) {
      const [quoted] = await tx.select({ id: posts.id }).from(posts).where(and(eq(posts.id, input.quoted_post_id), eq(posts.status, "published"), isNull(posts.deletedAt))).limit(1);
      if (!quoted) throw new AppError(404, "NOT_FOUND", "The quoted Moment was not found.");
    }
    const [post] = await tx.insert(posts).values({ authorId, kind: input.kind, body: input.body, visibility: input.visibility, quotedPostId: input.quoted_post_id, actorType }).returning();
    if (!post) throw new Error("Unable to create the Moment.");
    await attachPostMedia(tx, authorId, post.id, input.media_asset_ids, "post");
    await syncTokens(tx, post.id, input.body);
    if (input.kind === "poll" && input.poll) {
      const endsAt = input.poll.ends_at ? new Date(input.poll.ends_at) : null;
      if (endsAt && endsAt <= new Date()) throw new AppError(422, "VALIDATION_ERROR", "Poll expiration must be in the future.", { "poll.ends_at": "Choose a future date and time." });
      await tx.insert(polls).values({ postId: post.id, question: input.poll.question, voterVisibility: input.poll.voter_visibility, allowVoteChange: input.poll.allow_vote_change, endsAt });
      await tx.insert(pollOptions).values(input.poll.options.map((label, position) => ({ pollId: post.id, label, position })));
    }
    return post;
  });
}

async function canView(post: typeof posts.$inferSelect, viewerId: string) {
  if (post.authorId === viewerId) return true;
  if (post.status !== "published" || post.visibility === "private") return false;
  const [blocked] = await getDb().select({ value: count() }).from(userBlocks).where(or(
    and(eq(userBlocks.blockerId, viewerId), eq(userBlocks.blockedId, post.authorId)),
    and(eq(userBlocks.blockerId, post.authorId), eq(userBlocks.blockedId, viewerId)),
  ));
  if ((blocked?.value ?? 0) > 0) return false;
  const authorProfile = await getUserProfile(post.authorId, viewerId);
  if (authorProfile?.privacy.private_profile && authorProfile.relationship !== "following") return false;
  if (post.visibility === "public") return true;
  const [follow] = await getDb().select({ value: count() }).from(follows).where(and(eq(follows.followerId, viewerId), eq(follows.followingId, post.authorId), eq(follows.status, "active")));
  return (follow?.value ?? 0) > 0;
}

export async function findPost(id: string) {
  const [post] = await getDb().select().from(posts).where(and(eq(posts.id, id), isNull(posts.deletedAt))).limit(1);
  return post ?? null;
}

export async function hydratePost(id: string, viewerId: string, includeQuote = true): Promise<Record<string, unknown> | null> {
  const post = await findPost(id);
  if (!post || !await canView(post, viewerId)) return null;
  const db = getDb();
  const [author, media, articleRows, pollRows, optionRows, stateRows, voteRows, rewardRows] = await Promise.all([
    getUserProfile(post.authorId, viewerId),
    db.select({ id: mediaAssets.id, url: mediaAssets.gatewayUrl, mime_type: mediaAssets.mimeType, alt_text: mediaAssets.altText, position: postMedia.position }).from(postMedia).innerJoin(mediaAssets, eq(mediaAssets.id, postMedia.mediaAssetId)).where(eq(postMedia.postId, post.id)).orderBy(postMedia.position),
    db.select().from(articles).where(eq(articles.postId, post.id)).limit(1),
    db.select().from(polls).where(eq(polls.postId, post.id)).limit(1),
    db.select().from(pollOptions).where(eq(pollOptions.pollId, post.id)).orderBy(pollOptions.position),
    Promise.all([
      db.select({ id: postLikes.postId }).from(postLikes).where(and(eq(postLikes.postId, post.id), eq(postLikes.userId, viewerId))).limit(1),
      db.select({ id: bookmarks.postId }).from(bookmarks).where(and(eq(bookmarks.postId, post.id), eq(bookmarks.userId, viewerId))).limit(1),
      db.select({ id: reposts.postId }).from(reposts).where(and(eq(reposts.postId, post.id), eq(reposts.userId, viewerId))).limit(1),
    ]),
    db.select({ optionId: pollVotes.optionId }).from(pollVotes).where(and(eq(pollVotes.pollId, post.id), eq(pollVotes.userId, viewerId))).limit(1),
    db.select({ id: rewardClaims.id }).from(rewardClaims).where(and(eq(rewardClaims.userId, viewerId), eq(rewardClaims.claimKey, `moment:${post.id}`))).limit(1),
  ]);
  const article = articleRows[0];
  const poll = pollRows[0];
  return {
    id: post.id,
    kind: post.kind,
    body: post.status === "deleted" ? "" : post.body,
    visibility: post.visibility,
    status: post.status,
    version: post.version,
    actor_type: post.actorType,
    author,
    media,
    counts: { likes: post.likeCount, replies: post.replyCount, reposts: post.repostCount, bookmarks: post.bookmarkCount, views: post.viewCount },
    viewer: { liked: stateRows[0].length > 0, bookmarked: stateRows[1].length > 0, reposted: stateRows[2].length > 0, reward_claimed: rewardRows.length > 0 },
    article: article ? { title: article.title, eyebrow: article.eyebrow, description: article.description, content_html: article.contentHtml, banner_media_id: article.bannerMediaId, banner_color: article.bannerColor, banner_position: article.bannerPosition, status: article.status, draft_version: article.draftVersion, published_at: article.publishedAt?.toISOString() ?? null } : null,
    poll: poll ? { question: poll.question, status: poll.status, voter_visibility: poll.voterVisibility, allow_vote_change: poll.allowVoteChange, total_votes: poll.totalVotes, ends_at: poll.endsAt?.toISOString() ?? null, viewer_option_id: voteRows[0]?.optionId ?? null, options: optionRows.map((option) => ({ id: option.id, label: option.label, position: option.position, vote_count: option.voteCount })) } : null,
    quoted_post: includeQuote && post.quotedPostId ? await hydratePost(post.quotedPostId, viewerId, false) : null,
    created_at: post.createdAt.toISOString(),
    updated_at: post.updatedAt.toISOString(),
    published_at: post.publishedAt?.toISOString() ?? null,
    pinned: Boolean(post.pinnedAt),
    is_owner: post.authorId === viewerId,
  };
}

export async function listLatestPosts(viewerId: string, limit: number, cursorValue?: string, mode: "latest" | "top" | "for_you" = "latest") {
  const cursor = decodeCursor(cursorValue);
  const rankingAt = cursor?.ranking_at ? new Date(cursor.ranking_at) : new Date();
  const rankingAtValue = rankingAt.toISOString();
  const ageHours = sql<number>`greatest(0, extract(epoch from (${rankingAtValue}::timestamptz - coalesce(${posts.publishedAt}, ${posts.createdAt}))) / 3600)`;
  const engagement = sql<number>`(${posts.likeCount} * 2 + ${posts.replyCount} * 5 + ${posts.repostCount} * 6 + ${posts.bookmarkCount} * 3 + least(${posts.viewCount}, 5000) / 200.0)`;
  const freshness = sql<number>`greatest(0, 72 - ${ageHours}) * 0.75`;
  const inNetwork = sql<boolean>`exists (select 1 from ${follows} feed_follow where feed_follow.follower_id = ${viewerId} and feed_follow.following_id = ${posts.authorId} and feed_follow.status = 'active')`;
  const authorAffinity = sql<number>`least(24, (
    select count(*) * 2 from ${postLikes} affinity_like
    inner join ${posts} affinity_post on affinity_post.id = affinity_like.post_id
    where affinity_like.user_id = ${viewerId} and affinity_post.author_id = ${posts.authorId} and affinity_like.created_at > ${rankingAtValue}::timestamptz - interval '90 days'
  ) + (
    select count(*) * 3 from ${reposts} affinity_repost
    inner join ${posts} affinity_post on affinity_post.id = affinity_repost.post_id
    where affinity_repost.user_id = ${viewerId} and affinity_post.author_id = ${posts.authorId} and affinity_repost.created_at > ${rankingAtValue}::timestamptz - interval '90 days'
  ) + (
    select count(*) * 3 from ${postReplies} affinity_reply
    where affinity_reply.author_id = ${viewerId} and affinity_reply.post_id in (
      select affinity_post.id from ${posts} affinity_post where affinity_post.author_id = ${posts.authorId}
    ) and affinity_reply.created_at > ${rankingAtValue}::timestamptz - interval '90 days'
  ))`;
  const topicAffinity = sql<number>`least(15, coalesce((
    select count(distinct candidate_tag.hashtag_id) * 5
    from ${postHashtags} candidate_tag
    where candidate_tag.post_id = ${posts.id} and exists (
      select 1 from ${postHashtags} affinity_tag
      inner join ${postLikes} affinity_like on affinity_like.post_id = affinity_tag.post_id
      where affinity_tag.hashtag_id = candidate_tag.hashtag_id and affinity_like.user_id = ${viewerId}
    )
  ), 0))`;
  const viewedPenalty = sql<number>`case when exists (select 1 from ${postViews} feed_view where feed_view.post_id = ${posts.id} and feed_view.user_id = ${viewerId}) then 8 else 0 end`;
  const score = mode === "latest"
    ? sql<number>`0`
    : mode === "top"
      ? engagement
      : sql<number>`(
        (${engagement} / power(greatest(2, ${ageHours} + 2), 0.65)) * 5
        + ${freshness}
        + case when ${inNetwork} then 32 else 0 end
        + case when ${posts.authorId} = ${viewerId} then 6 else 0 end
        + ${authorAffinity}
        + ${topicAffinity}
        - ${viewedPenalty}
      )`;
  const rows = await getDb().select({
    id: posts.id,
    authorId: posts.authorId,
    publishedAt: posts.publishedAt,
    score,
    likes: posts.likeCount,
    replies: posts.replyCount,
    reposts: posts.repostCount,
    views: posts.viewCount,
    freshness,
    authorAffinity,
    topicAffinity,
    inNetwork,
  }).from(posts).where(and(
    eq(posts.status, "published"), isNull(posts.deletedAt),
    or(
      eq(posts.authorId, viewerId),
      and(
        eq(posts.visibility, "public"),
        or(
          sql`not exists (select 1 from user_profiles private_profile where private_profile.user_id = ${posts.authorId} and private_profile.private_profile = true)`,
          sql`exists (select 1 from ${follows} f where f.follower_id = ${viewerId} and f.following_id = ${posts.authorId} and f.status = 'active')`,
        ),
      ),
      and(eq(posts.visibility, "followers"), sql`exists (select 1 from ${follows} f where f.follower_id = ${viewerId} and f.following_id = ${posts.authorId} and f.status = 'active')`),
    ),
    sql`not exists (select 1 from ${userBlocks} b where (b.blocker_id = ${viewerId} and b.blocked_id = ${posts.authorId}) or (b.blocker_id = ${posts.authorId} and b.blocked_id = ${viewerId}))`,
    sql`not exists (select 1 from ${userMutes} m where m.muter_id = ${viewerId} and m.muted_id = ${posts.authorId} and (m.expires_at is null or m.expires_at > now()))`,
    mode === "latest" && cursor ? or(lt(posts.publishedAt, new Date(cursor.created_at)), and(eq(posts.publishedAt, new Date(cursor.created_at)), lt(posts.id, cursor.id))) : undefined,
    mode !== "latest" && cursor?.score !== undefined ? or(lt(score, cursor.score), and(eq(score, cursor.score), or(lt(posts.publishedAt, new Date(cursor.created_at)), and(eq(posts.publishedAt, new Date(cursor.created_at)), lt(posts.id, cursor.id))))) : undefined,
  )).orderBy(mode === "latest" ? desc(posts.publishedAt) : desc(score), desc(posts.publishedAt), desc(posts.id)).limit(limit + 1);
  const { page, cursorRow, hasMore } = paginateFeedCandidates(rows, limit, mode === "for_you");
  const hydrated = await Promise.all(page.map((row) => hydratePost(row.id, viewerId)));
  // Impressions are analytics signals only. They are intentionally not used as
  // an exclusion filter, so opening or refreshing For You never removes posts.
  if (page.length) {
    await getDb().insert(feedImpressions).values(page.map((row) => ({
      userId: viewerId,
      postId: row.id,
      feedMode: mode,
      rankingVersion: "v3",
      score: mode === "latest" ? null : Math.round(Number(row.score)),
      context: { cursor: Boolean(cursorValue), signals: { likes: row.likes, replies: row.replies, reposts: row.reposts, views: row.views, freshness: Number(row.freshness), author_affinity: Number(row.authorAffinity), topic_affinity: Number(row.topicAffinity), in_network: Boolean(row.inNetwork) } },
    })));
  }
  return {
    data: hydrated.filter((post): post is NonNullable<typeof post> => Boolean(post)),
    hasMore,
    nextCursor: hasMore && cursorRow?.publishedAt ? encodeCursor({ created_at: cursorRow.publishedAt.toISOString(), id: cursorRow.id, ...(mode !== "latest" ? { score: Number(cursorRow.score), ranking_at: rankingAt.toISOString() } : {}) }) : null,
    snapshotAt: new Date().toISOString(),
  };
}

export async function listUserPosts(authorId: string, viewerId: string, limit: number, cursorValue?: string) {
  const cursor = decodeCursor(cursorValue);
  const activityAt = sql<Date>`coalesce(${reposts.createdAt}, ${posts.publishedAt}, ${posts.createdAt})`;
  const activityCursor = cursor ? or(lt(activityAt, cursor.created_at), and(eq(activityAt, cursor.created_at), lt(posts.id, cursor.id))) : undefined;
  const pinnedAtCursor = cursor?.pinned_at ? sql<Date>`${cursor.pinned_at}::timestamptz` : undefined;
  const profileCursor = cursor?.pinned === true && cursor.pinned_at
    ? or(isNull(posts.pinnedAt), and(lt(posts.pinnedAt, pinnedAtCursor!)), and(eq(posts.pinnedAt, pinnedAtCursor!), activityCursor))
    : cursor?.pinned === false
      ? and(isNull(posts.pinnedAt), activityCursor)
      : activityCursor;
  const rows = await getDb().select({ id: posts.id, publishedAt: posts.publishedAt, pinnedAt: posts.pinnedAt, activityAt, reposted: sql<boolean>`${reposts.userId} is not null` }).from(posts).leftJoin(reposts, and(eq(reposts.postId, posts.id), eq(reposts.userId, authorId))).where(and(
    or(eq(posts.authorId, authorId), eq(reposts.userId, authorId)),
    eq(posts.status, "published"),
    isNull(posts.deletedAt),
    authorId === viewerId ? undefined : or(
      eq(posts.visibility, "public"),
      and(eq(posts.visibility, "followers"), sql`exists (select 1 from ${follows} profile_follow where profile_follow.follower_id = ${viewerId} and profile_follow.following_id = ${authorId} and profile_follow.status = 'active')`),
    ),
    sql`not exists (select 1 from ${userBlocks} profile_block where (profile_block.blocker_id = ${viewerId} and profile_block.blocked_id = ${authorId}) or (profile_block.blocker_id = ${authorId} and profile_block.blocked_id = ${viewerId}))`,
    profileCursor,
  )).orderBy(sql`(${posts.pinnedAt} is not null) desc`, desc(posts.pinnedAt), desc(activityAt), desc(posts.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const repostAuthor = page.some((row) => row.reposted) ? await getUserProfile(authorId, viewerId) : null;
  const hydrated = await Promise.all(page.map(async (row) => {
    const post = await hydratePost(row.id, viewerId);
    if (!post) return null;
    const activityDate = new Date(row.activityAt);
    return { ...post, activity_type: row.reposted ? "repost" : "post", activity_at: activityDate.toISOString(), reposted_by: row.reposted ? repostAuthor : null };
  }));
  const last = page.at(-1);
  return {
    data: hydrated.filter((post): post is NonNullable<typeof post> => Boolean(post)),
    hasMore: rows.length > limit,
    nextCursor: rows.length > limit && last ? encodeCursor({ created_at: new Date(last.activityAt).toISOString(), id: last.id, pinned: Boolean(last.pinnedAt), pinned_at: last.pinnedAt?.toISOString() ?? null }) : null,
  };
}

export async function setPostPinned(authorId: string, postId: string, pinned: boolean) {
  return getDb().transaction(async (tx) => {
    const [owned] = await tx.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.authorId, authorId), eq(posts.status, "published"), isNull(posts.deletedAt))).limit(1);
    if (!owned) return null;
    if (pinned) await tx.update(posts).set({ pinnedAt: null, updatedAt: new Date() }).where(and(eq(posts.authorId, authorId), isNull(posts.deletedAt)));
    const [updated] = await tx.update(posts).set({ pinnedAt: pinned ? new Date() : null, updatedAt: new Date() }).where(eq(posts.id, postId)).returning({ id: posts.id, pinnedAt: posts.pinnedAt });
    return updated ?? null;
  });
}

export async function countNewFeedPosts(viewerId: string, since: Date) {
  const [row] = await getDb().select({ value: count() }).from(posts).where(and(
    eq(posts.status, "published"),
    isNull(posts.deletedAt),
    gt(posts.publishedAt, since),
    ne(posts.authorId, viewerId),
    or(
      eq(posts.visibility, "public"),
      and(
        eq(posts.visibility, "followers"),
        sql`exists (select 1 from follows f where f.follower_id = ${viewerId} and f.following_id = ${posts.authorId} and f.status = 'active')`,
      ),
    ),
    sql`not exists (select 1 from user_blocks b where (b.blocker_id = ${viewerId} and b.blocked_id = ${posts.authorId}) or (b.blocker_id = ${posts.authorId} and b.blocked_id = ${viewerId}))`,
    sql`not exists (select 1 from user_mutes m where m.muter_id = ${viewerId} and m.muted_id = ${posts.authorId} and (m.expires_at is null or m.expires_at > now()))`,
  ));
  return Number(row?.value ?? 0);
}

export async function listBookmarkedPosts(viewerId: string, filter: "all" | "media" | "text", limit: number, cursorValue?: string) {
  const cursor = decodeCursor(cursorValue);
  const rows = await getDb().select({ postId: bookmarks.postId, createdAt: bookmarks.createdAt }).from(bookmarks).innerJoin(posts, eq(posts.id, bookmarks.postId)).where(and(
    eq(bookmarks.userId, viewerId), eq(posts.status, "published"), isNull(posts.deletedAt),
    filter === "media" ? sql`exists (select 1 from ${postMedia} pm where pm.post_id = ${posts.id})` : undefined,
    filter === "text" ? sql`not exists (select 1 from ${postMedia} pm where pm.post_id = ${posts.id})` : undefined,
    cursor ? or(lt(bookmarks.createdAt, new Date(cursor.created_at)), and(eq(bookmarks.createdAt, new Date(cursor.created_at)), lt(bookmarks.postId, cursor.id))) : undefined,
  )).orderBy(desc(bookmarks.createdAt), desc(bookmarks.postId)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const data = await Promise.all(page.map((row) => hydratePost(row.postId, viewerId)));
  const last = page.at(-1);
  return { data: data.filter((post): post is Record<string, unknown> => Boolean(post)), hasMore: rows.length > limit, nextCursor: rows.length > limit && last ? encodeCursor({ created_at: last.createdAt.toISOString(), id: last.postId }) : null };
}

export async function listLikedPosts(viewerId: string, filter: "all" | "media" | "text", limit: number, cursorValue?: string) {
  const cursor = decodeCursor(cursorValue);
  const rows = await getDb().select({ postId: postLikes.postId, createdAt: postLikes.createdAt }).from(postLikes).innerJoin(posts, eq(posts.id, postLikes.postId)).where(and(
    eq(postLikes.userId, viewerId), eq(posts.status, "published"), isNull(posts.deletedAt),
    filter === "media" ? sql`exists (select 1 from ${postMedia} pm where pm.post_id = ${posts.id})` : undefined,
    filter === "text" ? sql`not exists (select 1 from ${postMedia} pm where pm.post_id = ${posts.id})` : undefined,
    cursor ? or(lt(postLikes.createdAt, new Date(cursor.created_at)), and(eq(postLikes.createdAt, new Date(cursor.created_at)), lt(postLikes.postId, cursor.id))) : undefined,
  )).orderBy(desc(postLikes.createdAt), desc(postLikes.postId)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const data = await Promise.all(page.map((row) => hydratePost(row.postId, viewerId)));
  const last = page.at(-1);
  return { data: data.filter((post): post is Record<string, unknown> => Boolean(post)), hasMore: rows.length > limit, nextCursor: rows.length > limit && last ? encodeCursor({ created_at: last.createdAt.toISOString(), id: last.postId }) : null };
}

export async function updatePost(authorId: string, postId: string, expectedVersion: number, input: UpdatePostInput) {
  return getDb().transaction(async (tx) => {
    const [updated] = await tx.update(posts).set({ ...input, version: sql`${posts.version} + 1`, updatedAt: new Date() }).where(and(eq(posts.id, postId), eq(posts.authorId, authorId), eq(posts.version, expectedVersion), ne(posts.status, "deleted"), isNull(posts.deletedAt))).returning();
    if (updated && input.body !== undefined) await syncTokens(tx, postId, input.body);
    return updated ?? null;
  });
}

export async function softDeletePost(authorId: string, postId: string) {
  const [deleted] = await getDb().update(posts).set({ status: "deleted", body: "", deletedAt: new Date(), version: sql`${posts.version} + 1`, updatedAt: new Date() }).where(and(eq(posts.id, postId), eq(posts.authorId, authorId), ne(posts.status, "deleted"), isNull(posts.deletedAt))).returning();
  return deleted ?? null;
}

export async function createArticle(authorId: string, input: CreateArticleInput) {
  return getDb().transaction(async (tx) => {
    const cleanHtml = sanitizeArticleHtml(input.content_html);
    const contentText = articlePlainText(cleanHtml);
    if (!contentText) throw new AppError(422, "VALIDATION_ERROR", "Article content cannot be empty after sanitization.", { content_html: "Add readable article content." });
    const published = input.publish;
    const [post] = await tx.insert(posts).values({ authorId, kind: "article", body: input.description, visibility: input.visibility, status: published ? "published" : "draft", publishedAt: published ? new Date() : null }).returning();
    if (!post) throw new Error("Unable to create the article.");
    if (input.banner_media_id) await attachPostMedia(tx, authorId, post.id, [input.banner_media_id], "article");
    await tx.insert(articles).values({ postId: post.id, title: input.title, eyebrow: input.eyebrow, description: input.description, contentHtml: cleanHtml, contentText, bannerMediaId: input.banner_media_id, bannerColor: input.banner_color, bannerPosition: input.banner_position, status: published ? "published" : "draft", publishedAt: published ? new Date() : null });
    await syncTokens(tx, post.id, `${input.title} ${input.description} ${contentText}`);
    return post;
  });
}

export async function updateArticle(authorId: string, postId: string, input: UpdateArticleInput) {
  return getDb().transaction(async (tx) => {
    const [owner] = await tx.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.authorId, authorId), eq(posts.kind, "article"), isNull(posts.deletedAt))).limit(1);
    if (!owner) return null;
    const [currentArticle] = await tx.select({ bannerMediaId: articles.bannerMediaId }).from(articles).where(eq(articles.postId, postId)).limit(1);
    if (!currentArticle) return null;
    if (input.banner_media_id && input.banner_media_id !== currentArticle.bannerMediaId) {
      const [banner] = await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.id, input.banner_media_id), eq(mediaAssets.ownerId, authorId), eq(mediaAssets.status, "ready"), eq(mediaAssets.purpose, "article"), isNull(mediaAssets.attachedAt), isNull(mediaAssets.deletedAt))).limit(1);
      if (!banner) throw new AppError(422, "VALIDATION_ERROR", "The article banner is not available.", { banner_media_id: "Upload a ready article image that belongs to you." });
      if (currentArticle.bannerMediaId) await tx.update(mediaAssets).set({ attachedAt: null, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), updatedAt: new Date() }).where(eq(mediaAssets.id, currentArticle.bannerMediaId));
      await tx.update(mediaAssets).set({ attachedAt: new Date(), expiresAt: null, updatedAt: new Date() }).where(eq(mediaAssets.id, banner.id));
    }
    const cleanHtml = input.content_html !== undefined ? sanitizeArticleHtml(input.content_html) : undefined;
    const contentText = cleanHtml !== undefined ? articlePlainText(cleanHtml) : undefined;
    if (cleanHtml !== undefined && !contentText) throw new AppError(422, "VALIDATION_ERROR", "Article content cannot be empty after sanitization.", { content_html: "Add readable article content." });
    const [updated] = await tx.update(articles).set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.eyebrow !== undefined ? { eyebrow: input.eyebrow } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(cleanHtml !== undefined ? { contentHtml: cleanHtml, contentText: contentText! } : {}),
      ...(input.banner_media_id !== undefined ? { bannerMediaId: input.banner_media_id } : {}),
      ...(input.banner_color !== undefined ? { bannerColor: input.banner_color } : {}),
      ...(input.banner_position !== undefined ? { bannerPosition: input.banner_position } : {}),
      draftVersion: sql`${articles.draftVersion} + 1`, updatedAt: new Date(),
    }).where(and(eq(articles.postId, postId), eq(articles.draftVersion, input.draft_version))).returning();
    if (!updated) return "version_conflict" as const;
    await tx.update(posts).set({ ...(input.description !== undefined ? { body: input.description } : {}), ...(input.visibility !== undefined ? { visibility: input.visibility } : {}), version: sql`${posts.version} + 1`, updatedAt: new Date() }).where(eq(posts.id, postId));
    return updated;
  });
}

export async function publishArticle(authorId: string, postId: string) {
  return getDb().transaction(async (tx) => {
    const [article] = await tx.update(articles).set({ status: "published", publishedAt: sql`coalesce(${articles.publishedAt}, now())`, draftVersion: sql`${articles.draftVersion} + 1`, updatedAt: new Date() }).where(eq(articles.postId, postId)).returning();
    if (!article) return null;
    const [post] = await tx.update(posts).set({ status: "published", publishedAt: sql`coalesce(${posts.publishedAt}, now())`, version: sql`${posts.version} + 1`, updatedAt: new Date() }).where(and(eq(posts.id, postId), eq(posts.authorId, authorId), eq(posts.kind, "article"), isNull(posts.deletedAt))).returning();
    if (!post) throw new AppError(403, "FORBIDDEN", "Only the article author can publish it.");
    return post;
  });
}

export async function createReply(authorId: string, postId: string, input: CreateReplyInput, actorType: "human" | "mcp_agent" = "human") {
  return getDb().transaction(async (tx) => {
    const [post] = await tx.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.status, "published"), isNull(posts.deletedAt))).limit(1);
    if (!post) throw new AppError(404, "NOT_FOUND", "The Moment was not found.");
    if (input.parent_id) {
      const [parent] = await tx.select({ id: postReplies.id }).from(postReplies).where(and(eq(postReplies.id, input.parent_id), eq(postReplies.postId, postId), eq(postReplies.status, "published"))).limit(1);
      if (!parent) throw new AppError(422, "VALIDATION_ERROR", "The parent reply is invalid.", { parent_id: "Choose a reply from the same Moment." });
    }
    const [reply] = await tx.insert(postReplies).values({ postId, authorId, parentId: input.parent_id, body: input.body, actorType }).returning();
    if (!reply) throw new Error("Unable to create the reply.");
    await attachReplyMedia(tx, authorId, reply.id, input.media_asset_ids);
    const mentions = extractTokens(input.body).mentions;
    if (mentions.length) {
      const mentioned = await tx.select({ id: users.id }).from(users).where(and(inArray(users.usernameNormalized, mentions), eq(users.status, "active"), isNull(users.deletedAt)));
      if (mentioned.length) await tx.insert(replyMentions).values(mentioned.map((user) => ({ replyId: reply.id, mentionedUserId: user.id }))).onConflictDoNothing();
    }
    await tx.update(posts).set({ replyCount: sql`${posts.replyCount} + 1`, updatedAt: new Date() }).where(eq(posts.id, postId));
    if (input.parent_id) await tx.update(postReplies).set({ replyCount: sql`${postReplies.replyCount} + 1`, updatedAt: new Date() }).where(eq(postReplies.id, input.parent_id));
    return reply;
  });
}

async function hydrateReplyRow(reply: typeof postReplies.$inferSelect, viewerId: string) {
  const [author, media, liked] = await Promise.all([
    getUserProfile(reply.authorId, viewerId),
    getDb().select({ id: mediaAssets.id, url: mediaAssets.gatewayUrl, mime_type: mediaAssets.mimeType, alt_text: mediaAssets.altText })
      .from(replyMedia)
      .innerJoin(mediaAssets, eq(mediaAssets.id, replyMedia.mediaAssetId))
      .where(eq(replyMedia.replyId, reply.id)),
    getDb().select({ id: replyLikes.replyId })
      .from(replyLikes)
      .where(and(eq(replyLikes.replyId, reply.id), eq(replyLikes.userId, viewerId)))
      .limit(1),
  ]);
  if (!author) throw new Error("Unable to hydrate the reply author.");
  return {
    id: reply.id,
    post_id: reply.postId,
    parent_id: reply.parentId,
    body: reply.status === "deleted" ? "" : reply.body,
    status: reply.status,
    author,
    media,
    like_count: reply.likeCount,
    reply_count: reply.replyCount,
    viewer_liked: liked.length > 0,
    is_owner: reply.authorId === viewerId,
    created_at: reply.createdAt.toISOString(),
    updated_at: reply.updatedAt.toISOString(),
  };
}

export async function hydrateReply(replyId: string, viewerId: string) {
  const [reply] = await getDb().select().from(postReplies).where(and(eq(postReplies.id, replyId), ne(postReplies.status, "moderated"))).limit(1);
  return reply ? hydrateReplyRow(reply, viewerId) : null;
}

export async function listReplies(postId: string, viewerId: string, limit: number, cursorValue?: string, parentId?: string) {
  const cursor = decodeCursor(cursorValue);
  const rows = await getDb().select().from(postReplies).where(and(
    eq(postReplies.postId, postId), parentId ? eq(postReplies.parentId, parentId) : isNull(postReplies.parentId), ne(postReplies.status, "moderated"),
    cursor ? or(gt(postReplies.createdAt, new Date(cursor.created_at)), and(eq(postReplies.createdAt, new Date(cursor.created_at)), gt(postReplies.id, cursor.id))) : undefined,
  )).orderBy(postReplies.createdAt, postReplies.id).limit(limit + 1);
  const page = rows.slice(0, limit);
  const data = await Promise.all(page.map((reply) => hydrateReplyRow(reply, viewerId)));
  const last = page.at(-1);
  return { data, hasMore: rows.length > limit, nextCursor: rows.length > limit && last ? encodeCursor({ created_at: last.createdAt.toISOString(), id: last.id }) : null };
}

export async function updateReply(authorId: string, replyId: string, body: string) {
  const [reply] = await getDb().update(postReplies).set({ body, updatedAt: new Date() }).where(and(eq(postReplies.id, replyId), eq(postReplies.authorId, authorId), eq(postReplies.status, "published"))).returning();
  return reply ?? null;
}

export async function findReply(replyId: string) {
  const [reply] = await getDb().select().from(postReplies).where(and(eq(postReplies.id, replyId), ne(postReplies.status, "deleted"), isNull(postReplies.deletedAt))).limit(1);
  return reply ?? null;
}

export async function softDeleteReply(authorId: string, replyId: string) {
  const [reply] = await getDb().update(postReplies).set({ body: "", status: "deleted", deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(postReplies.id, replyId), eq(postReplies.authorId, authorId), eq(postReplies.status, "published"))).returning();
  return reply ?? null;
}

async function togglePostRelation(table: typeof postLikes | typeof bookmarks | typeof reposts, counter: typeof posts.likeCount | typeof posts.bookmarkCount | typeof posts.repostCount, counterKey: "likeCount" | "bookmarkCount" | "repostCount", userId: string, postId: string, enabled: boolean) {
  return getDb().transaction(async (tx) => {
    if (enabled) {
      const inserted = await tx.insert(table as typeof postLikes).values({ userId, postId }).onConflictDoNothing().returning({ postId: table.postId });
      if (inserted.length) await tx.update(posts).set({ [counterKey]: sql`${counter} + 1`, updatedAt: new Date() }).where(eq(posts.id, postId));
    } else {
      const removed = await tx.delete(table as typeof postLikes).where(and(eq(table.userId, userId), eq(table.postId, postId))).returning({ postId: table.postId });
      if (removed.length) await tx.update(posts).set({ [counterKey]: sql`greatest(${counter} - 1, 0)`, updatedAt: new Date() }).where(eq(posts.id, postId));
    }
    const [post] = await tx.select({ count: counter }).from(posts).where(eq(posts.id, postId)).limit(1);
    return { active: enabled, count: post?.count ?? 0 };
  });
}

export const setPostLike = (userId: string, postId: string, enabled: boolean) => togglePostRelation(postLikes, posts.likeCount, "likeCount", userId, postId, enabled);
export const setBookmark = (userId: string, postId: string, enabled: boolean) => togglePostRelation(bookmarks, posts.bookmarkCount, "bookmarkCount", userId, postId, enabled);
export const setRepost = (userId: string, postId: string, enabled: boolean) => togglePostRelation(reposts, posts.repostCount, "repostCount", userId, postId, enabled);

export async function setReplyLike(userId: string, replyId: string, enabled: boolean) {
  return getDb().transaction(async (tx) => {
    if (enabled) {
      const inserted = await tx.insert(replyLikes).values({ userId, replyId }).onConflictDoNothing().returning();
      if (inserted.length) await tx.update(postReplies).set({ likeCount: sql`${postReplies.likeCount} + 1`, updatedAt: new Date() }).where(eq(postReplies.id, replyId));
    } else {
      const removed = await tx.delete(replyLikes).where(and(eq(replyLikes.userId, userId), eq(replyLikes.replyId, replyId))).returning();
      if (removed.length) await tx.update(postReplies).set({ likeCount: sql`greatest(${postReplies.likeCount} - 1, 0)`, updatedAt: new Date() }).where(eq(postReplies.id, replyId));
    }
    const [reply] = await tx.select({ count: postReplies.likeCount }).from(postReplies).where(eq(postReplies.id, replyId)).limit(1);
    return { active: enabled, count: reply?.count ?? 0 };
  });
}

export async function votePoll(userId: string, postId: string, optionId: string) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select ${polls.postId} from ${polls} where ${polls.postId} = ${postId} for update`);
    const [poll] = await tx.select().from(polls).where(eq(polls.postId, postId)).limit(1);
    if (!poll) throw new AppError(404, "NOT_FOUND", "The poll was not found.");
    if (poll.status !== "open" || poll.endsAt && poll.endsAt <= new Date()) throw new AppError(409, "CONFLICT", "This poll is closed.");
    const [option] = await tx.select({ id: pollOptions.id }).from(pollOptions).where(and(eq(pollOptions.id, optionId), eq(pollOptions.pollId, postId))).limit(1);
    if (!option) throw new AppError(422, "VALIDATION_ERROR", "The poll option is invalid.", { option_id: "Choose an option from this poll." });
    const [existing] = await tx.select({ optionId: pollVotes.optionId }).from(pollVotes).where(and(eq(pollVotes.pollId, postId), eq(pollVotes.userId, userId))).limit(1);
    if (existing?.optionId === optionId) return finalPollState(tx, postId, userId);
    if (existing && !poll.allowVoteChange) throw new AppError(409, "CONFLICT", "This poll does not allow vote changes.");
    if (existing) {
      await tx.update(pollVotes).set({ optionId, updatedAt: new Date() }).where(and(eq(pollVotes.pollId, postId), eq(pollVotes.userId, userId)));
      await tx.update(pollOptions).set({ voteCount: sql`greatest(${pollOptions.voteCount} - 1, 0)` }).where(eq(pollOptions.id, existing.optionId));
    } else {
      await tx.insert(pollVotes).values({ pollId: postId, optionId, userId });
      await tx.update(polls).set({ totalVotes: sql`${polls.totalVotes} + 1`, updatedAt: new Date() }).where(eq(polls.postId, postId));
    }
    await tx.update(pollOptions).set({ voteCount: sql`${pollOptions.voteCount} + 1` }).where(eq(pollOptions.id, optionId));
    return finalPollState(tx, postId, userId);
  });
}

export async function removePollVote(userId: string, postId: string) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select ${polls.postId} from ${polls} where ${polls.postId} = ${postId} for update`);
    const [removed] = await tx.delete(pollVotes).where(and(eq(pollVotes.pollId, postId), eq(pollVotes.userId, userId))).returning({ optionId: pollVotes.optionId });
    if (removed) {
      await tx.update(pollOptions).set({ voteCount: sql`greatest(${pollOptions.voteCount} - 1, 0)` }).where(eq(pollOptions.id, removed.optionId));
      await tx.update(polls).set({ totalVotes: sql`greatest(${polls.totalVotes} - 1, 0)`, updatedAt: new Date() }).where(eq(polls.postId, postId));
    }
    return finalPollState(tx, postId, userId);
  });
}

async function finalPollState(tx: Tx, postId: string, userId: string) {
  const [poll, options, vote] = await Promise.all([
    tx.select().from(polls).where(eq(polls.postId, postId)).limit(1),
    tx.select({ id: pollOptions.id, label: pollOptions.label, position: pollOptions.position, vote_count: pollOptions.voteCount }).from(pollOptions).where(eq(pollOptions.pollId, postId)).orderBy(pollOptions.position),
    tx.select({ optionId: pollVotes.optionId }).from(pollVotes).where(and(eq(pollVotes.pollId, postId), eq(pollVotes.userId, userId))).limit(1),
  ]);
  return { total_votes: poll[0]?.totalVotes ?? 0, viewer_option_id: vote[0]?.optionId ?? null, options };
}

export async function listPollVoters(postId: string, viewerId: string, limit: number, cursorValue?: string) {
  const [poll] = await getDb().select().from(polls).where(eq(polls.postId, postId)).limit(1);
  if (!poll) throw new AppError(404, "NOT_FOUND", "The poll was not found.");
  if (poll.voterVisibility === "anonymous") throw new AppError(403, "FORBIDDEN", "Voters are anonymous for this poll.");
  const cursor = decodeCursor(cursorValue);
  const rows = await getDb().select({ userId: pollVotes.userId, optionId: pollVotes.optionId, createdAt: pollVotes.createdAt }).from(pollVotes).where(and(
    eq(pollVotes.pollId, postId), cursor ? or(lt(pollVotes.createdAt, new Date(cursor.created_at)), and(eq(pollVotes.createdAt, new Date(cursor.created_at)), lt(pollVotes.userId, cursor.id))) : undefined,
  )).orderBy(desc(pollVotes.createdAt), desc(pollVotes.userId)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const data = await Promise.all(page.map(async (row) => ({ option_id: row.optionId, user: await getUserProfile(row.userId, viewerId), voted_at: row.createdAt.toISOString() })));
  const last = page.at(-1);
  return { data, hasMore: rows.length > limit, nextCursor: rows.length > limit && last ? encodeCursor({ created_at: last.createdAt.toISOString(), id: last.userId }) : null };
}

export async function closePoll(authorId: string, postId: string) {
  const [owner] = await getDb().select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.authorId, authorId), eq(posts.kind, "poll"), isNull(posts.deletedAt))).limit(1);
  if (!owner) return null;
  const [poll] = await getDb().update(polls).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(and(eq(polls.postId, postId), eq(polls.status, "open"))).returning();
  return poll ?? (await getDb().select().from(polls).where(eq(polls.postId, postId)).limit(1))[0] ?? null;
}

export async function recordView(userId: string, postId: string, viewerHash: string) {
  return getDb().transaction(async (tx) => {
    const inserted = await tx.insert(postViews).values({ userId, postId, viewerHash }).onConflictDoNothing().returning({ id: postViews.id });
    if (inserted.length) await tx.update(posts).set({ viewCount: sql`${posts.viewCount} + 1` }).where(eq(posts.id, postId));
    const [post] = await tx.select({ views: posts.viewCount }).from(posts).where(eq(posts.id, postId)).limit(1);
    return { recorded: inserted.length > 0, views: post?.views ?? 0 };
  });
}

export async function recordShare(userId: string, postId: string, channel: string) {
  const post = await findPost(postId);
  if (!post) throw new AppError(404, "NOT_FOUND", "The Moment was not found.");
  const [share] = await getDb().insert(postShares).values({ userId, postId, channel }).returning({ id: postShares.id });
  return { id: share!.id, recorded: true as const };
}
