import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/client";
import { rewardLedger, users } from "../../db/schema";
import { hashToken } from "./session";
import {
  createDatabaseSession,
  resolveSessionByTokenHash,
  revokeSessionByTokenHash,
  upsertGoogleIdentity,
} from "./auth.repository";
import {
  blockUser,
  getUserProfile,
  listPendingFollowerIds,
  listRelationshipIds,
  muteUser,
  persistOnboarding,
  persistProfileUpdate,
  respondToFollowRequest,
  setFollowRelationship,
  unmuteUser,
  usernameIsAvailable,
} from "../users/users.repository";

const run = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;
const emails = ["phase2-a@paymoment.test", "phase2-b@paymoment.test"];

describe("database-backed identity integration", () => {
  afterAll(async () => {
    if (process.env.RUN_DB_INTEGRATION !== "1") return;
    const testUsers = await getDb().select({ id: users.id }).from(users).where(inArray(users.email, emails));
    if (testUsers.length) {
      await getDb().delete(rewardLedger).where(inArray(rewardLedger.userId, testUsers.map((user) => user.id)));
    }
    await getDb().delete(users).where(inArray(users.email, emails));
  });

  run("persists identity, isolates browser sessions, and enforces profile relationships and entitlements", async () => {
    const first = await upsertGoogleIdentity({
      providerAccountId: "phase2-google-a",
      email: emails[0]!,
      emailVerified: true,
      displayName: "Phase Two A",
      avatarUrl: null,
    });
    const second = await upsertGoogleIdentity({
      providerAccountId: "phase2-google-b",
      email: emails[1]!,
      emailVerified: true,
      displayName: "Phase Two B",
      avatarUrl: null,
    });
    expect(first?.id).toBeTruthy();
    expect(second?.id).toBeTruthy();
    if (!first || !second) throw new Error("Integration users were not created.");

    const rawToken = "phase-two-opaque-token";
    await createDatabaseSession(first.id, {
      tokenHash: hashToken(rawToken),
      userAgent: "integration-test",
      ipHash: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await resolveSessionByTokenHash(hashToken(rawToken)))?.user.email).toBe(emails[0]);

    const secondRawToken = "phase-two-second-browser-token";
    await createDatabaseSession(second.id, {
      tokenHash: hashToken(secondRawToken),
      userAgent: "integration-test-second-browser",
      ipHash: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await resolveSessionByTokenHash(hashToken(secondRawToken)))?.user.email).toBe(emails[1]);

    await persistOnboarding(first.id, {
      displayName: "Phase Two A",
      username: "phase.two.a",
      usernameNormalized: "phase.two.a",
      bio: "Integration profile",
      birthDate: null,
      interestSlugs: ["technology"],
    }, [{ type: "terms", version: "test" }, { type: "privacy", version: "test" }], null);
    expect((await getUserProfile(first.id, first.id))?.username).toBe("phase.two.a");

    await persistOnboarding(second.id, {
      displayName: "Phase Two B",
      username: "phase.two.b",
      usernameNormalized: "phase.two.b",
      bio: "Second browser profile",
      birthDate: null,
      interestSlugs: ["technology"],
    }, [{ type: "terms", version: "test" }, { type: "privacy", version: "test" }], null);

    await expect(persistProfileUpdate(second.id, {
      username: "phase.two.a",
      usernameNormalized: "phase.two.a",
    })).rejects.toMatchObject({ code: "USERNAME_TAKEN", status: 409 });
    await persistProfileUpdate(first.id, {
      username: "phase.two.renamed",
      usernameNormalized: "phase.two.renamed",
    });
    expect(await usernameIsAvailable("phase.two.a", second.id)).toBeFalse();

    await persistProfileUpdate(second.id, { privateProfile: true });
    expect(await setFollowRelationship(first.id, second.id)).toBe("pending");
    expect((await listPendingFollowerIds(second.id)).map((row) => row.id)).toContain(first.id);
    expect(await respondToFollowRequest(second.id, first.id, true)).toBeTrue();
    expect((await getUserProfile(second.id, first.id))?.relationship).toBe("following");
    expect((await listRelationshipIds(first.id, "following", 20)).ids).toContain(second.id);

    await muteUser(first.id, second.id, null);
    expect((await getUserProfile(second.id, first.id))?.relationship).toBe("muted");
    await unmuteUser(first.id, second.id);
    expect((await getUserProfile(second.id, first.id))?.relationship).toBe("following");

    await getDb().insert(rewardLedger).values({
      userId: first.id,
      entryType: "earn",
      sourceType: "system",
      amount: 10_000,
      balanceAfter: 10_000,
      idempotencyKey: "phase2-verified-threshold",
      description: "Phase 2 verified entitlement test",
    });
    const verifiedSession = await resolveSessionByTokenHash(hashToken(rawToken));
    expect(verifiedSession?.user.entitlement.points_balance).toBe(10_000);
    expect(verifiedSession?.user.entitlement.verified).toBeTrue();
    expect((await getUserProfile(first.id, first.id))?.entitlement.verified).toBeTrue();

    await blockUser(first.id, second.id);
    expect((await getUserProfile(second.id, first.id))?.relationship).toBe("blocked");

    await revokeSessionByTokenHash(hashToken(rawToken));
    expect(await resolveSessionByTokenHash(hashToken(rawToken))).toBeNull();
    expect((await resolveSessionByTokenHash(hashToken(secondRawToken)))?.user.email).toBe(emails[1]);
    await revokeSessionByTokenHash(hashToken(secondRawToken));
    expect(await resolveSessionByTokenHash(hashToken(secondRawToken))).toBeNull();
    expect((await getDb().select({ id: users.id }).from(users).where(eq(users.email, emails[0]!))).length).toBe(1);
  });
});
