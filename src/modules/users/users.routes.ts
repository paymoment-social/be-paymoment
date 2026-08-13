import { Hono } from "hono";
import { z } from "zod";
import { paginated, success } from "../../lib/responses";
import { enforceRateLimit } from "../../lib/rate-limit";
import { parseJson, parseQuery } from "../../lib/validation";
import { requireSession } from "../auth/auth.service";
import { listContentQuerySchema } from "../posts/posts.schemas";
import { getUserPosts } from "../posts/posts.service";
import { listUsersQuerySchema, muteUserSchema, onboardingSchema, updateProfileSchema } from "./users.schemas";
import {
  checkUsernameAvailability,
  completeOnboarding,
  follow,
  getMyProfile,
  getProfileByUsername,
  listActiveInterests,
  listFollowRequests,
  listRelationships,
  markVerifiedAchievementSeen,
  respondFollowRequest,
  setBlocked,
  setMuted,
  unfollow,
  updateMyProfile,
} from "./users.service";

const usersRoutes = new Hono();

usersRoutes.get("/interests", async (c) => {
  await requireSession(c);
  return success(c, { interests: await listActiveInterests() });
});

usersRoutes.get("/username-availability", async (c) => {
  const session = await requireSession(c);
  const query = parseQuery(c, z.object({ username: z.string().min(1).max(31) }));
  await enforceRateLimit(c, "username.availability", session.user.id, 30, 60);
  return success(c, await checkUsernameAvailability(query.username, session.user.id));
});

usersRoutes.get("/me", async (c) => {
  const session = await requireSession(c);
  return success(c, { user: await getMyProfile(session.user.id) });
});

usersRoutes.post("/me/onboarding", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "user.onboarding", session.user.id, 5, 60 * 60);
  const input = await parseJson(c, onboardingSchema);
  return success(c, { user: await completeOnboarding(c, session.user.id, input) });
});

usersRoutes.patch("/me", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "user.profile.update", session.user.id, 20, 60 * 60);
  const input = await parseJson(c, updateProfileSchema);
  return success(c, { user: await updateMyProfile(session.user.id, input) });
});

usersRoutes.put("/me/verified-achievement-seen", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "user.verified-achievement.seen", session.user.id, 10, 60 * 60);
  return success(c, await markVerifiedAchievementSeen(session.user.id));
});

usersRoutes.get("/me/follow-requests", async (c) => {
  const session = await requireSession(c);
  return success(c, { users: await listFollowRequests(session.user.id) });
});

usersRoutes.put("/follow-requests/:followerId", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "user.follow-request.respond", session.user.id, 60, 60);
  return success(c, await respondFollowRequest(session.user.id, c.req.param("followerId"), true));
});

usersRoutes.delete("/follow-requests/:followerId", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "user.follow-request.respond", session.user.id, 60, 60);
  return success(c, await respondFollowRequest(session.user.id, c.req.param("followerId"), false));
});

usersRoutes.put("/:id/follow", async (c) => {
  const session = await requireSession(c);
  await enforceRateLimit(c, "user.follow", session.user.id, 120, 60 * 60);
  return success(c, await follow(session.user.id, c.req.param("id")));
});

usersRoutes.delete("/:id/follow", async (c) => {
  const session = await requireSession(c);
  return success(c, await unfollow(session.user.id, c.req.param("id")));
});

usersRoutes.put("/:id/block", async (c) => {
  const session = await requireSession(c);
  return success(c, await setBlocked(session.user.id, c.req.param("id"), true));
});

usersRoutes.delete("/:id/block", async (c) => {
  const session = await requireSession(c);
  return success(c, await setBlocked(session.user.id, c.req.param("id"), false));
});

usersRoutes.put("/:id/mute", async (c) => {
  const session = await requireSession(c);
  const input = await parseJson(c, muteUserSchema);
  return success(c, await setMuted(session.user.id, c.req.param("id"), true, input.expires_at));
});

usersRoutes.delete("/:id/mute", async (c) => {
  const session = await requireSession(c);
  return success(c, await setMuted(session.user.id, c.req.param("id"), false));
});

usersRoutes.get("/:id/followers", async (c) => {
  const session = await requireSession(c);
  const query = parseQuery(c, listUsersQuerySchema);
  const page = await listRelationships(c.req.param("id"), "followers", session.user.id, query.limit, query.cursor);
  return paginated(c, page.profiles, page.nextCursor, page.hasMore);
});

usersRoutes.get("/:id/following", async (c) => {
  const session = await requireSession(c);
  const query = parseQuery(c, listUsersQuerySchema);
  const page = await listRelationships(c.req.param("id"), "following", session.user.id, query.limit, query.cursor);
  return paginated(c, page.profiles, page.nextCursor, page.hasMore);
});

usersRoutes.get("/:username/posts", async (c) => {
  const session = await requireSession(c);
  const query = parseQuery(c, listContentQuerySchema.omit({ parent_id: true }));
  const page = await getUserPosts(session.user.id, c.req.param("username"), query.limit, query.cursor);
  return paginated(c, page.data, page.nextCursor, page.hasMore);
});

usersRoutes.get("/:username", async (c) => {
  const session = await requireSession(c);
  return success(c, { user: await getProfileByUsername(c.req.param("username"), session.user.id) });
});

export { usersRoutes };
