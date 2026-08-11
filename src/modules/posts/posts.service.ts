import { z } from "zod";
import { AppError } from "../../lib/errors";
import { hashPrivateValue } from "../auth/session";
import { getUserProfile, userIdByUsername } from "../users/users.repository";
import { recordTrendingHashtags } from "../discover/trending";
import { createNotification } from "../notifications/notifications.repository";
import { extractTokens } from "./content";
import type { CreateArticleInput, CreatePostInput, CreateReplyInput, UpdateArticleInput, UpdatePostInput } from "./posts.schemas";
import {
  closePoll,
  createArticle,
  createPost,
  createReply,
  findReply,
  findPost,
  hydratePost,
  hydrateReply,
  listPollVoters,
  listLatestPosts,
  listUserPosts,
  countNewFeedPosts,
  listBookmarkedPosts,
  listLikedPosts,
  listReplies,
  publishArticle,
  recordShare,
  recordView,
  removePollVote,
  setBookmark,
  setPostLike,
  setReplyLike,
  setRepost,
  softDeletePost,
  softDeleteReply,
  updateArticle,
  updatePost,
  updateReply,
  votePoll,
} from "./posts.repository";

function validId(value: string, entity: string) {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw new AppError(404, "NOT_FOUND", `The ${entity} was not found.`);
  return result.data;
}

async function notifyMentions(actorId: string, body: string, target: { postId?: string; replyId?: string }) {
  const handles = extractTokens(body).mentions;
  await Promise.all(handles.map(async (handle) => {
    const userId = await userIdByUsername(handle);
    if (userId) await createNotification({ userId, actorId, type: "mention", postId: target.postId, replyId: target.replyId, dedupeKey: `mention:${target.postId ?? target.replyId}:${userId}` });
  }));
}

async function visiblePost(viewerId: string, value: string) {
  const id = validId(value, "Moment");
  const post = await hydratePost(id, viewerId);
  if (!post) throw new AppError(404, "NOT_FOUND", "The Moment was not found.");
  return { id, post };
}

async function ownedPost(ownerId: string, value: string, kind?: "article" | "poll") {
  const id = validId(value, kind ?? "Moment");
  const post = await findPost(id);
  if (!post) throw new AppError(404, "NOT_FOUND", `The ${kind ?? "Moment"} was not found.`);
  if (post.authorId !== ownerId) throw new AppError(403, "FORBIDDEN", `Only the ${kind ?? "Moment"} author can modify it.`);
  if (kind && post.kind !== kind) throw new AppError(404, "NOT_FOUND", `The ${kind} was not found.`);
  return post;
}

export function parseVersionHeader(value: string | undefined) {
  if (!value) throw new AppError(428, "CONFLICT", "An If-Match version header is required.");
  const version = Number(value.replace(/^W\//, "").replaceAll('"', ""));
  if (!Number.isInteger(version) || version <= 0) throw new AppError(422, "VALIDATION_ERROR", "The If-Match version is invalid.", { "If-Match": "Use the current positive integer version." });
  return version;
}

export async function createMoment(userId: string, input: CreatePostInput, actorType: "human" | "mcp_agent" = "human") {
  const created = await createPost(userId, input, actorType);
  void recordTrendingHashtags(extractTokens(input.body).hashtags);
  await notifyMentions(userId, input.body, { postId: created.id });
  return (await hydratePost(created.id, userId))!;
}

export async function getMoment(userId: string, id: string) {
  return (await visiblePost(userId, id)).post;
}

export async function getLatestFeed(userId: string, limit: number, cursor?: string, mode: "latest" | "top" | "for_you" = "latest") {
  return listLatestPosts(userId, limit, cursor, mode);
}

export async function getUserPosts(viewerId: string, username: string, limit: number, cursor?: string) {
  const targetId = await userIdByUsername(username.trim().toLowerCase());
  if (!targetId) throw new AppError(404, "NOT_FOUND", "The user profile was not found.");
  const profile = await getUserProfile(targetId, viewerId);
  if (!profile) throw new AppError(404, "NOT_FOUND", "The user profile was not found.");
  return listUserPosts(targetId, viewerId, limit, cursor);
}

export function getNewFeedPostCount(userId: string, since: string) {
  return countNewFeedPosts(userId, new Date(since));
}

export function getBookmarks(userId: string, filter: "all" | "media" | "text", limit: number, cursor?: string) {
  return listBookmarkedPosts(userId, filter, limit, cursor);
}

export function getLikedPosts(userId: string, filter: "all" | "media" | "text", limit: number, cursor?: string) {
  return listLikedPosts(userId, filter, limit, cursor);
}

export async function getArticlePost(userId: string, idValue: string) {
  const visible = await visiblePost(userId, idValue);
  if ((visible.post as { kind?: string }).kind !== "article") throw new AppError(404, "NOT_FOUND", "The article was not found.");
  return visible.post;
}

export async function editMoment(userId: string, idValue: string, version: number, input: UpdatePostInput) {
  const current = await ownedPost(userId, idValue);
  if (current.version !== version) throw new AppError(409, "CONFLICT", "The Moment has changed since it was loaded.");
  const updated = await updatePost(userId, current.id, version, input);
  if (!updated) throw new AppError(409, "CONFLICT", "The Moment has changed since it was loaded.");
  return (await hydratePost(current.id, userId))!;
}

export async function deleteMoment(userId: string, idValue: string) {
  const current = await ownedPost(userId, idValue);
  const deleted = await softDeletePost(userId, current.id);
  if (!deleted) throw new AppError(409, "CONFLICT", "The Moment has already been deleted.");
  return { id: current.id, deleted: true as const };
}

export async function createArticlePost(userId: string, input: CreateArticleInput) {
  const profile = await getUserProfile(userId, userId);
  if (!profile?.entitlement.verified) throw new AppError(403, "FORBIDDEN", "A verified account is required to create articles.");
  const created = await createArticle(userId, input);
  return (await hydratePost(created.id, userId))!;
}

export async function editArticlePost(userId: string, idValue: string, input: UpdateArticleInput) {
  const current = await ownedPost(userId, idValue, "article");
  const updated = await updateArticle(userId, current.id, input);
  if (updated === "version_conflict") throw new AppError(409, "CONFLICT", "The article draft has changed since it was loaded.");
  if (!updated) throw new AppError(404, "NOT_FOUND", "The article was not found.");
  return (await hydratePost(current.id, userId))!;
}

export async function publishArticlePost(userId: string, idValue: string) {
  const current = await ownedPost(userId, idValue, "article");
  await publishArticle(userId, current.id);
  return (await hydratePost(current.id, userId))!;
}

export async function deleteArticlePost(userId: string, idValue: string) {
  const current = await ownedPost(userId, idValue, "article");
  const deleted = await softDeletePost(userId, current.id);
  if (!deleted) throw new AppError(409, "CONFLICT", "The article has already been deleted.");
  return { id: current.id, deleted: true as const };
}

export async function createPostReply(userId: string, postValue: string, input: CreateReplyInput, actorType: "human" | "mcp_agent" = "human") {
  const { id, post } = await visiblePost(userId, postValue);
  const reply = await createReply(userId, id, input, actorType);
  const authorId = (post as { author?: { id?: string } }).author?.id;
  if (authorId) await createNotification({ userId: authorId, actorId: userId, type: "reply", postId: id, replyId: reply.id, dedupeKey: `reply:${reply.id}` });
  await notifyMentions(userId, input.body, { postId: id, replyId: reply.id });
  const hydrated = await hydrateReply(reply.id, userId);
  if (!hydrated) throw new Error("Unable to hydrate the created reply.");
  return hydrated;
}

export async function getPostReplies(userId: string, postValue: string, limit: number, cursor?: string, parentId?: string) {
  const { id } = await visiblePost(userId, postValue);
  if (parentId) validId(parentId, "reply");
  return listReplies(id, userId, limit, cursor, parentId);
}

export async function editPostReply(userId: string, replyValue: string, body: string) {
  const id = validId(replyValue, "reply");
  const reply = await updateReply(userId, id, body);
  if (!reply) throw new AppError(404, "NOT_FOUND", "The reply was not found or cannot be edited.");
  const hydrated = await hydrateReply(reply.id, userId);
  if (!hydrated) throw new Error("Unable to hydrate the updated reply.");
  return hydrated;
}

export async function deletePostReply(userId: string, replyValue: string) {
  const id = validId(replyValue, "reply");
  const reply = await softDeleteReply(userId, id);
  if (!reply) throw new AppError(404, "NOT_FOUND", "The reply was not found or cannot be deleted.");
  return { id, deleted: true as const };
}

async function reaction(userId: string, postValue: string, enabled: boolean, type: "like" | "bookmark" | "repost") {
  const { id, post } = await visiblePost(userId, postValue);
  const state = type === "like" ? await setPostLike(userId, id, enabled) : type === "bookmark" ? await setBookmark(userId, id, enabled) : await setRepost(userId, id, enabled);
  const authorId = (post as { author?: { id?: string } }).author?.id;
  if (enabled && authorId && (type === "like" || type === "repost")) await createNotification({ userId: authorId, actorId: userId, type, postId: id, dedupeKey: `${type}:${userId}:${id}` });
  return { post_id: id, [type === "repost" ? "reposted" : `${type}d`]: state.active, count: state.count };
}

export const likeMoment = (userId: string, postId: string, enabled: boolean) => reaction(userId, postId, enabled, "like");
export const bookmarkMoment = (userId: string, postId: string, enabled: boolean) => reaction(userId, postId, enabled, "bookmark");
export const repostMoment = (userId: string, postId: string, enabled: boolean) => reaction(userId, postId, enabled, "repost");

export async function likeReply(userId: string, replyValue: string, enabled: boolean) {
  const id = validId(replyValue, "reply");
  const reply = await findReply(id);
  if (!reply) throw new AppError(404, "NOT_FOUND", "The reply was not found.");
  const state = await setReplyLike(userId, id, enabled);
  if (enabled) await createNotification({ userId: reply.authorId, actorId: userId, type: "like", replyId: id, dedupeKey: `reply-like:${userId}:${id}` });
  return { reply_id: id, liked: state.active, count: state.count };
}

export async function castPollVote(userId: string, postValue: string, optionId: string) {
  const { id } = await visiblePost(userId, postValue);
  return votePoll(userId, id, optionId);
}

export async function unvotePoll(userId: string, postValue: string) {
  const { id } = await visiblePost(userId, postValue);
  return removePollVote(userId, id);
}

export async function getPollVoters(userId: string, postValue: string, limit: number, cursor?: string) {
  const { id } = await visiblePost(userId, postValue);
  return listPollVoters(id, userId, limit, cursor);
}

export async function closeOwnedPoll(userId: string, postValue: string) {
  const current = await ownedPost(userId, postValue, "poll");
  const poll = await closePoll(userId, current.id);
  if (!poll) throw new AppError(404, "NOT_FOUND", "The poll was not found.");
  return { post_id: current.id, status: poll.status, closed_at: poll.closedAt?.toISOString() ?? null };
}

export async function registerView(userId: string, postValue: string) {
  const { id } = await visiblePost(userId, postValue);
  return recordView(userId, id, hashPrivateValue(`user:${userId}:post:${id}`));
}

export async function registerShare(userId: string, postValue: string, channel: string) {
  const { id } = await visiblePost(userId, postValue);
  return recordShare(userId, id, channel);
}
