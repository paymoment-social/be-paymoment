import { Hono } from "hono";
import { z } from "zod";
import { paginated, success } from "../../lib/responses";
import { enforceRateLimit } from "../../lib/rate-limit";
import { parseJson, parseQuery } from "../../lib/validation";
import { requireSession } from "../auth/auth.service";
import {
  createArticleSchema,
  createPostSchema,
  createReplySchema,
  listContentQuerySchema,
  listBookmarksQuerySchema,
  shareSchema,
  updateArticleSchema,
  updatePostSchema,
  updateReplySchema,
  votePollSchema,
} from "./posts.schemas";
import {
  bookmarkMoment,
  castPollVote,
  closeOwnedPoll,
  createArticlePost,
  createMoment,
  createPostReply,
  deleteMoment,
  deleteArticlePost,
  deletePostReply,
  editArticlePost,
  editMoment,
  editPostReply,
  getMoment,
  getLatestFeed,
  getBookmarks,
  getLikedPosts,
  getArticlePost,
  getPollVoters,
  getPostReplies,
  likeMoment,
  likeReply,
  parseVersionHeader,
  publishArticlePost,
  registerShare,
  registerView,
  repostMoment,
  unvotePoll,
} from "./posts.service";

const postsRoutes = new Hono();
const articlesRoutes = new Hono();
const repliesRoutes = new Hono();
const pollsRoutes = new Hono();
const feedRoutes = new Hono();
const bookmarksRoutes = new Hono();
const likesRoutes = new Hono();

feedRoutes.get("/", async (c) => {
  const session = await requireSession(c);
  const query = parseQuery(c, listContentQuerySchema.omit({ parent_id: true }).extend({ mode: z.enum(["latest", "top", "for_you"]).default("latest") }));
  const page = await getLatestFeed(session.user.id, query.limit, query.cursor, query.mode);
  return paginated(c, page.data, page.nextCursor, page.hasMore);
});

bookmarksRoutes.get("/", async (c) => {
  const session = await requireSession(c);
  const query = parseQuery(c, listBookmarksQuerySchema);
  const page = await getBookmarks(session.user.id, query.filter, query.limit, query.cursor);
  return paginated(c, page.data, page.nextCursor, page.hasMore);
});

likesRoutes.get("/", async (c) => {
  const session = await requireSession(c);
  const query = parseQuery(c, listBookmarksQuerySchema);
  const page = await getLikedPosts(session.user.id, query.filter, query.limit, query.cursor);
  return paginated(c, page.data, page.nextCursor, page.hasMore);
});

postsRoutes.post("/", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "post.create", session.user.id, 60, 60 * 60);
  return success(c, { post: await createMoment(session.user.id, await parseJson(c, createPostSchema)) });
});

postsRoutes.get("/:id", async (c) => {
  const session = await requireSession(c);
  return success(c, { post: await getMoment(session.user.id, c.req.param("id")) });
});

postsRoutes.patch("/:id", async (c) => {
  const session = await requireSession(c);
  const version = parseVersionHeader(c.req.header("if-match"));
  return success(c, { post: await editMoment(session.user.id, c.req.param("id"), version, await parseJson(c, updatePostSchema)) });
});

postsRoutes.delete("/:id", async (c) => {
  const session = await requireSession(c);
  return success(c, await deleteMoment(session.user.id, c.req.param("id")));
});

for (const [path, action] of [["like", likeMoment], ["bookmark", bookmarkMoment], ["repost", repostMoment]] as const) {
  postsRoutes.put(`/:id/${path}`, async (c) => {
    const session = await requireSession(c);
    await enforceRateLimit(c, `post.${path}`, session.user.id, 300, 60 * 60);
    return success(c, await action(session.user.id, c.req.param("id"), true));
  });
  postsRoutes.delete(`/:id/${path}`, async (c) => {
    const session = await requireSession(c);
    await enforceRateLimit(c, `post.${path}`, session.user.id, 300, 60 * 60);
    return success(c, await action(session.user.id, c.req.param("id"), false));
  });
}

postsRoutes.post("/:id/view", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "post.view", session.user.id, 600, 60 * 60);
  return success(c, await registerView(session.user.id, c.req.param("id")));
});

postsRoutes.post("/:id/share", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "post.share", session.user.id, 120, 60 * 60);
  const input = await parseJson(c, shareSchema);
  return success(c, await registerShare(session.user.id, c.req.param("id"), input.channel));
});

postsRoutes.get("/:id/replies", async (c) => {
  const session = await requireSession(c);
  const query = parseQuery(c, listContentQuerySchema);
  const page = await getPostReplies(session.user.id, c.req.param("id"), query.limit, query.cursor, query.parent_id);
  return paginated(c, page.data, page.nextCursor, page.hasMore);
});

postsRoutes.post("/:id/replies", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "reply.create", session.user.id, 120, 60 * 60);
  return success(c, { reply: await createPostReply(session.user.id, c.req.param("id"), await parseJson(c, createReplySchema)) });
});

articlesRoutes.post("/", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "article.create", session.user.id, 20, 60 * 60);
  return success(c, { post: await createArticlePost(session.user.id, await parseJson(c, createArticleSchema)) });
});

articlesRoutes.get("/:id", async (c) => {
  const session = await requireSession(c);
  return success(c, { post: await getArticlePost(session.user.id, c.req.param("id")) });
});

articlesRoutes.patch("/:id", async (c) => {
  const session = await requireSession(c);
  return success(c, { post: await editArticlePost(session.user.id, c.req.param("id"), await parseJson(c, updateArticleSchema)) });
});

articlesRoutes.post("/:id/publish", async (c) => {
  const session = await requireSession(c);
  return success(c, { post: await publishArticlePost(session.user.id, c.req.param("id")) });
});

articlesRoutes.delete("/:id", async (c) => {
  const session = await requireSession(c);
  return success(c, await deleteArticlePost(session.user.id, c.req.param("id")));
});

repliesRoutes.patch("/:id", async (c) => {
  const session = await requireSession(c);
  const input = await parseJson(c, updateReplySchema);
  return success(c, { reply: await editPostReply(session.user.id, c.req.param("id"), input.body) });
});

repliesRoutes.delete("/:id", async (c) => {
  const session = await requireSession(c);
  return success(c, await deletePostReply(session.user.id, c.req.param("id")));
});

repliesRoutes.put("/:id/like", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "reply.like", session.user.id, 300, 60 * 60);
  return success(c, await likeReply(session.user.id, c.req.param("id"), true));
});

repliesRoutes.delete("/:id/like", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "reply.like", session.user.id, 300, 60 * 60);
  return success(c, await likeReply(session.user.id, c.req.param("id"), false));
});

pollsRoutes.put("/:id/vote", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "poll.vote", session.user.id, 120, 60 * 60);
  const input = await parseJson(c, votePollSchema);
  return success(c, await castPollVote(session.user.id, c.req.param("id"), input.option_id));
});

pollsRoutes.delete("/:id/vote", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "poll.vote", session.user.id, 120, 60 * 60);
  return success(c, await unvotePoll(session.user.id, c.req.param("id")));
});

pollsRoutes.post("/:id/close", async (c) => {
  const session = await requireSession(c);
  return success(c, await closeOwnedPoll(session.user.id, c.req.param("id")));
});

pollsRoutes.get("/:id/voters", async (c) => {
  const session = await requireSession(c);
  const query = parseQuery(c, listContentQuerySchema.omit({ parent_id: true }));
  const page = await getPollVoters(session.user.id, c.req.param("id"), query.limit, query.cursor);
  return paginated(c, page.data, page.nextCursor, page.hasMore);
});

export { articlesRoutes, bookmarksRoutes, feedRoutes, likesRoutes, pollsRoutes, postsRoutes, repliesRoutes };
