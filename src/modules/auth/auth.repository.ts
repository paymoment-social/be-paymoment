import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import {
  oauthAccounts,
  rewardLedger,
  sessions,
  userEntitlements,
  userProfiles,
  userRoles,
  users,
} from "../../db/schema";
import type { SessionUser } from "../../contracts/auth";

export type GoogleIdentity = {
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
};

export type SessionMetadata = {
  tokenHash: string;
  userAgent: string | null;
  ipHash: string | null;
  expiresAt: Date;
};

export async function upsertGoogleIdentity(identity: GoogleIdentity) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [linked] = await tx.select({ userId: oauthAccounts.userId })
      .from(oauthAccounts)
      .where(and(eq(oauthAccounts.provider, "google"), eq(oauthAccounts.providerAccountId, identity.providerAccountId)))
      .limit(1);

    if (linked) {
      const [updated] = await tx.update(users).set({
        email: identity.email,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        updatedAt: new Date(),
      }).where(eq(users.id, linked.userId)).returning({ id: users.id });
      return updated;
    }

    const [emailOwner] = await tx.select({ id: users.id }).from(users)
      .where(sql`lower(${users.email}) = lower(${identity.email})`)
      .limit(1);

    const user = emailOwner ?? (await tx.insert(users).values({
      email: identity.email,
      emailVerified: identity.emailVerified,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
    }).returning({ id: users.id }))[0];

    if (!user) throw new Error("Unable to create the authenticated user.");
    if (emailOwner) {
      await tx.update(users).set({
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        updatedAt: new Date(),
      }).where(eq(users.id, user.id));
    }

    await tx.insert(oauthAccounts).values({
      userId: user.id,
      provider: "google",
      providerAccountId: identity.providerAccountId,
    });
    await tx.insert(userProfiles).values({ userId: user.id }).onConflictDoNothing();
    return user;
  });
}

export async function createDatabaseSession(userId: string, metadata: SessionMetadata) {
  const [session] = await getDb().insert(sessions).values({ userId, ...metadata }).returning({ id: sessions.id });
  if (!session) throw new Error("Unable to create the user session.");
  return session;
}

export async function revokeSessionByTokenHash(tokenHash: string) {
  await getDb().update(sessions).set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}

export async function resolveSessionByTokenHash(tokenHash: string): Promise<{ sessionId: string; user: SessionUser } | null> {
  const db = getDb();
  const [row] = await db.select({
    sessionId: sessions.id,
    userId: users.id,
    email: users.email,
    displayName: users.displayName,
    username: users.username,
    avatarUrl: users.avatarUrl,
    onboardingCompleted: users.onboardingCompleted,
  }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(
      eq(sessions.tokenHash, tokenHash),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()),
      eq(users.status, "active"),
      isNull(users.deletedAt),
    )).limit(1);

  if (!row) return null;

  const [[ledger], [entitlement], roles] = await Promise.all([
    db.select({ balance: rewardLedger.balanceAfter }).from(rewardLedger)
      .where(eq(rewardLedger.userId, row.userId)).orderBy(desc(rewardLedger.createdAt)).limit(1),
    db.select({ grantedAt: userEntitlements.grantedAt }).from(userEntitlements)
      .where(and(
        eq(userEntitlements.userId, row.userId),
        eq(userEntitlements.type, "verified"),
        isNull(userEntitlements.revokedAt),
      )).limit(1),
    db.select({ role: userRoles.role }).from(userRoles)
      .where(eq(userRoles.userId, row.userId)),
  ]);

  const pointsBalance = ledger?.balance ?? 0;
  let verifiedAt = entitlement?.grantedAt ?? null;
  if (!verifiedAt && pointsBalance >= 10_000) {
    const [granted] = await db.insert(userEntitlements).values({
      userId: row.userId,
      type: "verified",
      source: "points_threshold",
      metadata: { threshold: 10_000 },
    }).onConflictDoUpdate({
      target: [userEntitlements.userId, userEntitlements.type],
      set: { revokedAt: null, updatedAt: new Date() },
    }).returning({ grantedAt: userEntitlements.grantedAt });
    verifiedAt = granted?.grantedAt ?? new Date();
  }
  const verified = Boolean(verifiedAt);
  await db.update(sessions).set({ lastUsedAt: new Date(), updatedAt: new Date() }).where(eq(sessions.id, row.sessionId));
  return {
    sessionId: row.sessionId,
    user: {
      id: row.userId,
      email: row.email,
      display_name: row.displayName,
      username: row.username,
      avatar_url: row.avatarUrl,
      onboarding_completed: row.onboardingCompleted,
      roles: roles.map(({ role }) => role),
      entitlement: {
        verified,
        verified_at: verifiedAt?.toISOString() ?? null,
        points_balance: pointsBalance,
        verified_threshold: 10_000,
      },
    },
  };
}
