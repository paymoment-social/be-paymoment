import { afterAll, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { getDb } from "../../db/client";
import { posts, reports, userRoles, users } from "../../db/schema";
import { upsertGoogleIdentity } from "../auth/auth.repository";
import { createReport, listMyReports, reviewModerationReport } from "../reports/reports.repository";
import { countNewFeedPosts, createPost, listLatestPosts, setPostLike } from "../posts/posts.repository";
import { muteUser, persistOnboarding, setFollowRelationship } from "../users/users.repository";
import { searchDiscover } from "./discover.repository";

const run = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;
const emails = ["phase4-viewer@paymoment.test", "phase4-a@paymoment.test", "phase4-b@paymoment.test", "phase4-muted@paymoment.test"];

async function makeUser(index: number) {
  const user = await upsertGoogleIdentity({ providerAccountId: `phase4-google-${index}`, email: emails[index]!, emailVerified: true, displayName: `Phase Four ${index}`, avatarUrl: null });
  if (!user) throw new Error("Integration user could not be created.");
  const username = `phase.four.${index}`;
  await persistOnboarding(user.id, { displayName: `Phase Four ${index}`, username, usernameNormalized: username, bio: "", birthDate: null, interestSlugs: ["technology"] }, [{ type: "terms", version: "test" }, { type: "privacy", version: "test" }], null);
  return user;
}

describe("database-backed discover, ranking, and moderation integration", () => {
  afterAll(async () => {
    if (process.env.RUN_DB_INTEGRATION !== "1") return;
    const testUsers = await getDb().select({ id: users.id }).from(users).where(inArray(users.email, emails));
    const ids = testUsers.map((user) => user.id);
    if (ids.length) {
      await getDb().delete(reports).where(inArray(reports.reporterId, ids));
      await getDb().delete(posts).where(inArray(posts.authorId, ids));
      await getDb().delete(userRoles).where(inArray(userRoles.userId, ids));
      await getDb().delete(users).where(inArray(users.id, ids));
    }
  });

  run("enforces search visibility, ranking diversity, persistent feed impressions, and moderated reports", async () => {
    const [viewer, authorA, authorB, mutedAuthor] = await Promise.all([makeUser(0), makeUser(1), makeUser(2), makeUser(3)]);
    await setFollowRelationship(viewer.id, authorB.id);
    await muteUser(viewer.id, mutedAuthor.id, null);

    const aPosts = await Promise.all(["one", "two", "three"].map((suffix) => createPost(authorA.id, { kind: "moment", body: `Phase search A ${suffix} #phasefour`, visibility: "public", media_asset_ids: [] })));
    const followed = await createPost(authorB.id, { kind: "moment", body: "Phase search followed author", visibility: "public", media_asset_ids: [] });
    const muted = await createPost(mutedAuthor.id, { kind: "moment", body: "Phase search muted author", visibility: "public", media_asset_ids: [] });
    await setPostLike(viewer.id, followed.id, true);

    const discover = await searchDiscover(viewer.id, "Phase search", "moments", 10);
    const discoverIds = discover.moments.filter((post): post is Record<string, unknown> => post !== null).map((post) => String(post.id));
    expect(discoverIds).toContain(followed.id);
    expect(discoverIds).toContain(aPosts[0]!.id);
    expect(discoverIds).not.toContain(muted.id);

    const ranked = await listLatestPosts(viewer.id, 4, undefined, "for_you");
    const rankedIds = ranked.data.map((post) => String(post.id));
    expect(rankedIds).toContain(followed.id);
    expect(rankedIds).not.toContain(muted.id);
    expect(rankedIds.filter((id) => aPosts.some((post) => post.id === id))).toHaveLength(2);
    // For You is persistent like X/Threads: reading a post does not remove it.
    const refreshedForYou = await listLatestPosts(viewer.id, 4, undefined, "for_you");
    expect(refreshedForYou.data.map((post) => String(post.id))).toEqual(rankedIds);

    const ownPost = await createPost(viewer.id, { kind: "moment", body: "Phase search own post", visibility: "public", media_asset_ids: [] });
    expect(ownPost.publishedAt).not.toBeNull();
    expect(await countNewFeedPosts(viewer.id, new Date(ownPost.publishedAt!.getTime() - 1))).toBe(0);

    const report = await createReport(viewer.id, { target_type: "post", target_id: followed.id, reason: "spam", details: "Integration moderation case" });
    await getDb().insert(userRoles).values({ userId: authorA.id, role: "moderator" });
    const reviewed = await reviewModerationReport(authorA.id, report.id, { action: "resolved", resolution: "Removed for test coverage.", moderate_target: true }, "phase4-test-request");
    expect(reviewed.moderated).toBeTrue();
    expect((await listMyReports(viewer.id, 10))[0]?.status).toBe("resolved");
    const afterModeration = await listLatestPosts(viewer.id, 20, undefined, "top");
    expect(afterModeration.data.map((post) => String(post.id))).not.toContain(followed.id);
  });
});
