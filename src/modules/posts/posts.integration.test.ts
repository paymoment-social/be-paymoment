import { afterAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/client";
import { mediaAssets, posts as postsTable, userEntitlements, users } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { upsertGoogleIdentity } from "../auth/auth.repository";
import { persistOnboarding } from "../users/users.repository";
import {
  closePoll,
  createArticle,
  createPost,
  createReply,
  hydratePost,
  listPollVoters,
  listReplies,
  recordShare,
  recordView,
  removePollVote,
  setBookmark,
  setPostLike,
  setReplyLike,
  setRepost,
  softDeletePost,
  updateArticle,
  updatePost,
  votePoll,
} from "./posts.repository";
import { createPostReply } from "./posts.service";

const run = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;
const emails = ["phase3-a@paymoment.test", "phase3-b@paymoment.test"];

describe("database-backed content integration", () => {
  afterAll(async () => {
    if (process.env.RUN_DB_INTEGRATION !== "1") return;
    const testUsers = await getDb().select({ id: users.id }).from(users).where(inArray(users.email, emails));
    const ids = testUsers.map((user) => user.id);
    if (ids.length) {
      await getDb().delete(postsTable).where(inArray(postsTable.authorId, ids));
      await getDb().delete(mediaAssets).where(inArray(mediaAssets.ownerId, ids));
      await getDb().delete(users).where(inArray(users.id, ids));
    }
  });

  run("enforces ownership and persistent Moment, reply, poll, article, and reaction behavior", async () => {
    const first = await upsertGoogleIdentity({ providerAccountId: "phase3-google-a", email: emails[0]!, emailVerified: true, displayName: "Phase Three A", avatarUrl: null });
    const second = await upsertGoogleIdentity({ providerAccountId: "phase3-google-b", email: emails[1]!, emailVerified: true, displayName: "Phase Three B", avatarUrl: null });
    if (!first || !second) throw new Error("Integration users were not created.");
    await persistOnboarding(first.id, { displayName: "Phase Three A", username: "phase.three.a", usernameNormalized: "phase.three.a", bio: "", birthDate: null, interestSlugs: ["technology"] }, [{ type: "terms", version: "test" }, { type: "privacy", version: "test" }], null);
    await persistOnboarding(second.id, { displayName: "Phase Three B", username: "phase.three.b", usernameNormalized: "phase.three.b", bio: "", birthDate: null, interestSlugs: ["technology"] }, [{ type: "terms", version: "test" }, { type: "privacy", version: "test" }], null);
    await getDb().insert(userEntitlements).values({ userId: first.id, type: "verified", source: "phase3-test" });

    const foreignMedia = await getDb().insert(mediaAssets).values({ ownerId: second.id, mimeType: "image/png", extension: "png", byteSize: 12, checksumSha256: "b".repeat(64), purpose: "post", status: "ready", cid: "phase3-foreign", gatewayUrl: "https://gateway.pinata.cloud/ipfs/phase3-foreign" }).returning({ id: mediaAssets.id });
    await expect(createPost(first.id, { kind: "moment", body: "Wrong media", visibility: "public", media_asset_ids: [foreignMedia[0]!.id] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const ownedMedia = await getDb().insert(mediaAssets).values({ ownerId: first.id, mimeType: "image/png", extension: "png", byteSize: 12, checksumSha256: "a".repeat(64), purpose: "post", status: "ready", cid: "phase3-owned", gatewayUrl: "https://gateway.pinata.cloud/ipfs/phase3-owned" }).returning({ id: mediaAssets.id });
    const moment = await createPost(first.id, { kind: "moment", body: "Hello @phase.three.b #Build", visibility: "public", media_asset_ids: [ownedMedia[0]!.id] });
    const hydrated = await hydratePost(moment.id, first.id) as { media: unknown[]; counts: { likes: number }; version: number };
    expect(hydrated.media).toHaveLength(1);

    expect((await setPostLike(second.id, moment.id, true)).count).toBe(1);
    expect((await setPostLike(second.id, moment.id, true)).count).toBe(1);
    expect((await setPostLike(second.id, moment.id, false)).count).toBe(0);
    expect((await setPostLike(second.id, moment.id, false)).count).toBe(0);
    expect((await setBookmark(second.id, moment.id, true)).count).toBe(1);
    expect((await setBookmark(second.id, moment.id, true)).count).toBe(1);
    expect((await setRepost(second.id, moment.id, true)).count).toBe(1);
    expect((await setRepost(second.id, moment.id, true)).count).toBe(1);

    expect(await updatePost(second.id, moment.id, hydrated.version, { body: "Unauthorized" })).toBeNull();
    expect((await updatePost(first.id, moment.id, hydrated.version, { body: "Edited #Release" }))?.version).toBe(hydrated.version + 1);
    expect(await updatePost(first.id, moment.id, hydrated.version, { body: "Stale edit" })).toBeNull();
    expect((await recordView(second.id, moment.id, "phase3-viewer")).recorded).toBeTrue();
    expect((await recordView(second.id, moment.id, "phase3-viewer")).recorded).toBeFalse();
    expect((await recordShare(second.id, moment.id, "copy")).recorded).toBeTrue();

    const parent = await createPostReply(second.id, moment.id, { body: "Parent reply", media_asset_ids: [] });
    expect((parent.author as { id: string }).id).toBe(second.id);
    const child = await createReply(first.id, moment.id, { body: "Nested reply", parent_id: parent.id, media_asset_ids: [] });
    expect((await listReplies(moment.id, first.id, 20)).data).toHaveLength(1);
    expect((await listReplies(moment.id, first.id, 20, undefined, parent.id)).data[0]?.id).toBe(child.id);
    expect((await setReplyLike(first.id, parent.id, true)).count).toBe(1);
    expect((await setReplyLike(first.id, parent.id, true)).count).toBe(1);

    const pollPost = await createPost(first.id, { kind: "poll", body: "Choose", visibility: "public", media_asset_ids: [], poll: { question: "Which option?", options: ["One", "Two"], voter_visibility: "public", allow_vote_change: true } });
    const pollHydrated = await hydratePost(pollPost.id, second.id) as { poll: { options: Array<{ id: string }>; total_votes: number } };
    const [one, two] = pollHydrated.poll.options;
    expect((await votePoll(second.id, pollPost.id, one!.id)).total_votes).toBe(1);
    expect((await votePoll(second.id, pollPost.id, two!.id)).total_votes).toBe(1);
    expect((await listPollVoters(pollPost.id, first.id, 20)).data[0]?.user?.id).toBe(second.id);
    expect((await removePollVote(second.id, pollPost.id)).total_votes).toBe(0);
    expect((await closePoll(first.id, pollPost.id))?.status).toBe("closed");
    await expect(votePoll(second.id, pollPost.id, one!.id)).rejects.toMatchObject({ code: "CONFLICT" });

    const anonymousPoll = await createPost(first.id, { kind: "poll", body: "Private choices", visibility: "public", media_asset_ids: [], poll: { question: "Anonymous?", options: ["Yes", "No"], voter_visibility: "anonymous", allow_vote_change: false } });
    await expect(listPollVoters(anonymousPoll.id, first.id, 20)).rejects.toBeInstanceOf(AppError);

    const article = await createArticle(first.id, { title: "Secure article", description: "Description", content_html: '<p onclick="bad()">Readable</p><script>bad()</script>', banner_color: "#17181B", banner_position: "center", visibility: "public", publish: false });
    const articleHydrated = await hydratePost(article.id, first.id) as { article: { content_html: string; draft_version: number; status: string } };
    expect(articleHydrated.article.content_html).not.toContain("script");
    expect(articleHydrated.article.content_html).not.toContain("onclick");
    expect((await updateArticle(first.id, article.id, { draft_version: articleHydrated.article.draft_version, title: "Updated article" })) && true).toBeTrue();
    expect(await updateArticle(first.id, article.id, { draft_version: articleHydrated.article.draft_version, title: "Stale" })).toBe("version_conflict");
    expect((await softDeletePost(second.id, article.id))).toBeNull();
    expect((await softDeletePost(first.id, article.id))?.status).toBe("deleted");

    expect((await getDb().select({ id: postsTable.id }).from(postsTable).where(and(eq(postsTable.id, moment.id), eq(postsTable.authorId, first.id)))).length).toBe(1);
  });
});
