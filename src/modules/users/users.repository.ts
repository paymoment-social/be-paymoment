import { and, count, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import {
  follows,
  interests,
  policyConsents,
  rewardLedger,
  userBlocks,
  userEntitlements,
  userInterests,
  userMutes,
  userProfiles,
  usernameHistory,
  users,
} from "../../db/schema";
import { AppError } from "../../lib/errors";
import { decodeCursor, encodeCursor } from "../../lib/pagination";
import type { ProfileMutationData, RelationshipState, UserProfileResult } from "./users.types";

const VERIFIED_THRESHOLD = 10_000;

export async function listActiveInterests() {
  return getDb().select({ slug: interests.slug, label: interests.label }).from(interests)
    .where(eq(interests.active, true)).orderBy(interests.label);
}

export async function usernameIsAvailable(usernameNormalized: string, currentUserId?: string) {
  const db = getDb();
  const [owner] = await db.select({ id: users.id }).from(users).where(and(
    eq(users.usernameNormalized, usernameNormalized),
    currentUserId ? ne(users.id, currentUserId) : undefined,
  )).limit(1);
  if (owner) return false;
  const [reserved] = await db.select({ id: usernameHistory.id }).from(usernameHistory).where(and(
    eq(usernameHistory.usernameNormalized, usernameNormalized),
    gt(usernameHistory.releasedAt, new Date()),
    currentUserId ? ne(usernameHistory.userId, currentUserId) : undefined,
  )).limit(1);
  return !reserved;
}

export async function userIdByUsername(usernameNormalized: string) {
  const [row] = await getDb().select({ id: users.id }).from(users).where(and(
    eq(users.usernameNormalized, usernameNormalized),
    eq(users.status, "active"),
    isNull(users.deletedAt),
  )).limit(1);
  return row?.id ?? null;
}

export async function isBlockedByUser(blockerId: string, blockedId: string) {
  const [row] = await getDb().select({ blockerId: userBlocks.blockerId }).from(userBlocks)
    .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId))).limit(1);
  return Boolean(row);
}

export async function getUserProfile(userId: string, viewerId: string): Promise<UserProfileResult | null> {
  const db = getDb();
  const [base] = await db.select({
    id: users.id,
    email: users.email,
    displayName: users.displayName,
    username: users.username,
    avatarUrl: users.avatarUrl,
    onboardingCompleted: users.onboardingCompleted,
    joinedAt: users.createdAt,
    bio: userProfiles.bio,
    coverUrl: userProfiles.coverUrl,
    coverPosition: userProfiles.coverPosition,
    birthDate: userProfiles.birthDate,
    location: userProfiles.location,
    websiteUrl: userProfiles.websiteUrl,
    podcastUrl: userProfiles.podcastUrl,
    showPayboxBadge: userProfiles.showPayboxBadge,
    showRecentViews: userProfiles.showRecentViews,
    privateProfile: userProfiles.privateProfile,
    allowMessages: userProfiles.allowMessages,
  }).from(users).leftJoin(userProfiles, eq(userProfiles.userId, users.id)).where(and(
    eq(users.id, userId), eq(users.status, "active"), isNull(users.deletedAt),
  )).limit(1);
  if (!base) return null;

  const [followerCount, followingCount, interestRows, ledgerRows, entitlementRows, followRows, blockRows, muteRows] = await Promise.all([
    db.select({ value: count() }).from(follows).where(and(eq(follows.followingId, userId), eq(follows.status, "active"))),
    db.select({ value: count() }).from(follows).where(and(eq(follows.followerId, userId), eq(follows.status, "active"))),
    db.select({ slug: interests.slug, label: interests.label }).from(userInterests)
      .innerJoin(interests, eq(interests.id, userInterests.interestId)).where(eq(userInterests.userId, userId)).orderBy(interests.label),
    db.select({ balance: rewardLedger.balanceAfter }).from(rewardLedger).where(eq(rewardLedger.userId, userId)).orderBy(desc(rewardLedger.createdAt)).limit(1),
    db.select({ grantedAt: userEntitlements.grantedAt }).from(userEntitlements).where(and(
      eq(userEntitlements.userId, userId), eq(userEntitlements.type, "verified"), isNull(userEntitlements.revokedAt),
    )).limit(1),
    viewerId === userId ? Promise.resolve([]) : db.select({ status: follows.status }).from(follows)
      .where(and(eq(follows.followerId, viewerId), eq(follows.followingId, userId))).limit(1),
    viewerId === userId ? Promise.resolve([]) : db.select({ blockerId: userBlocks.blockerId }).from(userBlocks)
      .where(and(eq(userBlocks.blockerId, viewerId), eq(userBlocks.blockedId, userId))).limit(1),
    viewerId === userId ? Promise.resolve([]) : db.select({ muterId: userMutes.muterId }).from(userMutes)
      .where(and(eq(userMutes.muterId, viewerId), eq(userMutes.mutedId, userId), or(isNull(userMutes.expiresAt), gt(userMutes.expiresAt, new Date())))).limit(1),
  ]);

  const balance = ledgerRows[0]?.balance ?? 0;
  const verifiedAt = entitlementRows[0]?.grantedAt ?? null;
  let relationship: RelationshipState = "none";
  if (blockRows.length) relationship = "blocked";
  else if (muteRows.length) relationship = "muted";
  else if (followRows[0]?.status === "active") relationship = "following";
  else if (followRows[0]?.status === "pending") relationship = "pending";

  const isSelf = viewerId === userId;
  return {
    id: base.id,
    ...(isSelf ? { email: base.email } : {}),
    display_name: base.displayName,
    username: base.username,
    avatar_url: base.avatarUrl,
    cover_url: base.coverUrl ?? null,
    cover_position: (base.coverPosition === "top" || base.coverPosition === "bottom" ? base.coverPosition : "center") as "top" | "center" | "bottom",
    bio: base.bio ?? "",
    ...(isSelf ? { birth_date: base.birthDate } : {}),
    location: base.location ?? null,
    website_url: base.websiteUrl ?? null,
    podcast_url: base.podcastUrl ?? null,
    interests: interestRows,
    followers_count: followerCount[0]?.value ?? 0,
    following_count: followingCount[0]?.value ?? 0,
    onboarding_completed: base.onboardingCompleted,
    joined_at: base.joinedAt.toISOString(),
    privacy: {
      show_paybox_badge: base.showPayboxBadge ?? true,
      show_recent_views: base.showRecentViews ?? true,
      private_profile: base.privateProfile ?? false,
      allow_messages: base.allowMessages ?? true,
    },
    entitlement: {
      verified: Boolean(verifiedAt),
      verified_at: verifiedAt?.toISOString() ?? null,
      points_balance: balance,
      verified_threshold: VERIFIED_THRESHOLD,
    },
    relationship,
    is_self: isSelf,
  };
}

async function resolveInterestIds(slugs: string[], tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) {
  if (!slugs.length) return [];
  const rows = await tx.select({ id: interests.id, slug: interests.slug }).from(interests)
    .where(and(inArray(interests.slug, slugs), eq(interests.active, true)));
  if (rows.length !== new Set(slugs).size) throw new AppError(422, "VALIDATION_ERROR", "One or more selected interests are invalid.", { interest_slugs: "Select active interests only." });
  return rows.map((row) => row.id);
}

async function assertUsernameAvailableInTransaction(usernameNormalized: string, currentUserId: string, tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${usernameNormalized}, 0))`);
  const [conflict] = await tx.select({ id: users.id }).from(users).where(and(
    eq(users.usernameNormalized, usernameNormalized),
    ne(users.id, currentUserId),
  )).limit(1);
  const [reserved] = await tx.select({ id: usernameHistory.id }).from(usernameHistory).where(and(
    eq(usernameHistory.usernameNormalized, usernameNormalized),
    ne(usernameHistory.userId, currentUserId),
    gt(usernameHistory.releasedAt, new Date()),
  )).limit(1);
  if (conflict || reserved) throw new AppError(409, "USERNAME_TAKEN", "This username is already in use.", { username: "Choose another username." });
}

export async function persistOnboarding(userId: string, data: ProfileMutationData, consents: Array<{ type: string; version: string }>, ipHash: string | null) {
  const db = getDb();
  await db.transaction(async (tx) => {
    if (!data.usernameNormalized) throw new AppError(422, "VALIDATION_ERROR", "A username is required.", { username: "Enter a username." });
    await assertUsernameAvailableInTransaction(data.usernameNormalized, userId, tx);
    const interestIds = await resolveInterestIds(data.interestSlugs ?? [], tx);
    await tx.update(users).set({
      displayName: data.displayName,
      username: data.username,
      usernameNormalized: data.usernameNormalized,
      onboardingCompleted: true,
      updatedAt: new Date(),
    }).where(eq(users.id, userId));
    await tx.insert(userProfiles).values({
      userId,
      bio: data.bio,
      birthDate: data.birthDate,
    }).onConflictDoUpdate({ target: userProfiles.userId, set: { bio: data.bio, birthDate: data.birthDate, updatedAt: new Date() } });
    await tx.delete(userInterests).where(eq(userInterests.userId, userId));
    if (interestIds.length) await tx.insert(userInterests).values(interestIds.map((interestId) => ({ userId, interestId })));
    await tx.insert(policyConsents).values(consents.map((consent) => ({ userId, policyType: consent.type, policyVersion: consent.version, ipHash }))).onConflictDoNothing();
  });
}

export async function persistProfileUpdate(userId: string, data: ProfileMutationData) {
  const db = getDb();
  await db.transaction(async (tx) => {
    if (data.usernameNormalized) {
      await assertUsernameAvailableInTransaction(data.usernameNormalized, userId, tx);
      const [current] = await tx.select({ username: users.username, usernameNormalized: users.usernameNormalized }).from(users).where(eq(users.id, userId)).limit(1);
      if (current?.usernameNormalized && current.usernameNormalized !== data.usernameNormalized) {
        await tx.insert(usernameHistory).values({
          userId,
          username: current.username ?? current.usernameNormalized,
          usernameNormalized: current.usernameNormalized,
          releasedAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
        });
      }
    }
    const userSet = {
      ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
      ...(data.username !== undefined ? { username: data.username, usernameNormalized: data.usernameNormalized } : {}),
      ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
      updatedAt: new Date(),
    };
    await tx.update(users).set(userSet).where(eq(users.id, userId));

    const profileSet = {
      ...(data.bio !== undefined ? { bio: data.bio } : {}),
      ...(data.coverUrl !== undefined ? { coverUrl: data.coverUrl } : {}),
      ...(data.coverPosition !== undefined ? { coverPosition: data.coverPosition } : {}),
      ...(data.birthDate !== undefined ? { birthDate: data.birthDate } : {}),
      ...(data.location !== undefined ? { location: data.location } : {}),
      ...(data.websiteUrl !== undefined ? { websiteUrl: data.websiteUrl } : {}),
      ...(data.podcastUrl !== undefined ? { podcastUrl: data.podcastUrl } : {}),
      ...(data.showPayboxBadge !== undefined ? { showPayboxBadge: data.showPayboxBadge } : {}),
      ...(data.showRecentViews !== undefined ? { showRecentViews: data.showRecentViews } : {}),
      ...(data.privateProfile !== undefined ? { privateProfile: data.privateProfile } : {}),
      ...(data.allowMessages !== undefined ? { allowMessages: data.allowMessages } : {}),
      updatedAt: new Date(),
    };
    await tx.insert(userProfiles).values({ userId, ...profileSet }).onConflictDoUpdate({ target: userProfiles.userId, set: profileSet });

    if (data.interestSlugs) {
      const interestIds = await resolveInterestIds(data.interestSlugs, tx);
      await tx.delete(userInterests).where(eq(userInterests.userId, userId));
      if (interestIds.length) await tx.insert(userInterests).values(interestIds.map((interestId) => ({ userId, interestId })));
    }
  });
}

export async function setFollowRelationship(followerId: string, followingId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ privateProfile: userProfiles.privateProfile }).from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id)).where(and(eq(users.id, followingId), eq(users.status, "active"), isNull(users.deletedAt))).limit(1);
    if (!target) throw new AppError(404, "NOT_FOUND", "The user was not found.");
    const [blocked] = await tx.select({ blockerId: userBlocks.blockerId }).from(userBlocks).where(or(
      and(eq(userBlocks.blockerId, followerId), eq(userBlocks.blockedId, followingId)),
      and(eq(userBlocks.blockerId, followingId), eq(userBlocks.blockedId, followerId)),
    )).limit(1);
    if (blocked) throw new AppError(403, "FORBIDDEN", "A follow relationship cannot be created between blocked users.");
    const status = target.privateProfile ? "pending" as const : "active" as const;
    await tx.insert(follows).values({ followerId, followingId, status }).onConflictDoUpdate({
      target: [follows.followerId, follows.followingId], set: { status, updatedAt: new Date() },
    });
    return status;
  });
}

export async function removeFollowRelationship(followerId: string, followingId: string) {
  await getDb().update(follows).set({ status: "removed", updatedAt: new Date() })
    .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)));
}

export async function respondToFollowRequest(ownerId: string, followerId: string, accepted: boolean) {
  const [updated] = await getDb().update(follows).set({
    status: accepted ? "active" : "removed",
    updatedAt: new Date(),
  }).where(and(
    eq(follows.followerId, followerId),
    eq(follows.followingId, ownerId),
    eq(follows.status, "pending"),
  )).returning({ followerId: follows.followerId });
  return Boolean(updated);
}

export async function listPendingFollowerIds(ownerId: string) {
  return getDb().select({ id: follows.followerId }).from(follows)
    .where(and(eq(follows.followingId, ownerId), eq(follows.status, "pending")))
    .orderBy(desc(follows.createdAt)).limit(100);
}

export async function blockUser(blockerId: string, blockedId: string) {
  await getDb().transaction(async (tx) => {
    await tx.insert(userBlocks).values({ blockerId, blockedId }).onConflictDoNothing();
    await tx.update(follows).set({ status: "removed", updatedAt: new Date() }).where(or(
      and(eq(follows.followerId, blockerId), eq(follows.followingId, blockedId)),
      and(eq(follows.followerId, blockedId), eq(follows.followingId, blockerId)),
    ));
  });
}

export async function unblockUser(blockerId: string, blockedId: string) {
  await getDb().delete(userBlocks).where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)));
}

export async function muteUser(muterId: string, mutedId: string, expiresAt: Date | null) {
  await getDb().insert(userMutes).values({ muterId, mutedId, expiresAt }).onConflictDoUpdate({
    target: [userMutes.muterId, userMutes.mutedId], set: { expiresAt },
  });
}

export async function unmuteUser(muterId: string, mutedId: string) {
  await getDb().delete(userMutes).where(and(eq(userMutes.muterId, muterId), eq(userMutes.mutedId, mutedId)));
}

export async function listRelationshipIds(userId: string, direction: "followers" | "following", limit: number, cursorValue?: string) {
  const cursor = decodeCursor(cursorValue);
  const relatedId = direction === "followers" ? follows.followerId : follows.followingId;
  const ownerColumn = direction === "followers" ? follows.followingId : follows.followerId;
  const rows = await getDb().select({ id: relatedId, createdAt: follows.createdAt }).from(follows).where(and(
    eq(ownerColumn, userId),
    eq(follows.status, "active"),
    cursor ? or(lt(follows.createdAt, new Date(cursor.created_at)), and(eq(follows.createdAt, new Date(cursor.created_at)), lt(relatedId, cursor.id))) : undefined,
  )).orderBy(desc(follows.createdAt), desc(relatedId)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    ids: page.map((row) => row.id),
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ created_at: last.createdAt.toISOString(), id: last.id }) : null,
  };
}
