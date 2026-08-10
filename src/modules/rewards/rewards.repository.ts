import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { posts, rewardCatalog, rewardClaims, rewardLedger, users } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { getUserProfile } from "../users/users.repository";
import { createNotification } from "../notifications/notifications.repository";

async function balanceFor(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], userId: string) {
  const [row] = await tx.select({ balance: rewardLedger.balanceAfter }).from(rewardLedger).where(eq(rewardLedger.userId, userId)).orderBy(desc(rewardLedger.createdAt), desc(rewardLedger.id)).limit(1);
  return row?.balance ?? 0;
}

export async function getRewardBalance(userId: string) { const [row] = await getDb().select({ balance: rewardLedger.balanceAfter }).from(rewardLedger).where(eq(rewardLedger.userId, userId)).orderBy(desc(rewardLedger.createdAt), desc(rewardLedger.id)).limit(1); return row?.balance ?? 0; }
export async function listRewardLedger(userId: string) { return getDb().select().from(rewardLedger).where(eq(rewardLedger.userId, userId)).orderBy(desc(rewardLedger.createdAt), desc(rewardLedger.id)).limit(100); }
export async function listRewardCatalog() { return getDb().select().from(rewardCatalog).where(and(eq(rewardCatalog.active, true), orActive())).orderBy(rewardCatalog.costPoints); }
export async function listRewardLeaderboard(limit = 50) {
  const rows = await getDb().select({ userId: rewardLedger.userId, points: sql<number>`coalesce(sum(${rewardLedger.amount}), 0)` }).from(rewardLedger).innerJoin(users, eq(users.id, rewardLedger.userId)).where(and(eq(users.status, "active"), isNull(users.deletedAt))).groupBy(rewardLedger.userId).orderBy(desc(sql`coalesce(sum(${rewardLedger.amount}), 0)`), rewardLedger.userId).limit(limit);
  return Promise.all(rows.map(async (row, index) => ({ rank: index + 1, points: Number(row.points), user: await getUserProfile(row.userId, row.userId) })));
}
function orActive() { return sql`(${rewardCatalog.startsAt} is null or ${rewardCatalog.startsAt} <= now()) and (${rewardCatalog.endsAt} is null or ${rewardCatalog.endsAt} > now())`; }
export async function claimMomentReward(userId: string, postId: string) {
  const result = await getDb().transaction(async (tx) => {
    const [post] = await tx.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.authorId, userId), eq(posts.status, "published"), isNull(posts.deletedAt))).limit(1);
    if (!post) throw new AppError(404, "NOT_FOUND", "The Moment was not found.");
    const claimKey = `moment:${postId}`;
    const [prior] = await tx.select({ id: rewardClaims.id, ledgerEntryId: rewardClaims.ledgerEntryId }).from(rewardClaims).where(and(eq(rewardClaims.userId, userId), eq(rewardClaims.claimKey, claimKey))).limit(1);
    if (prior) return { ledger_entry_id: prior.ledgerEntryId, claimed: false, balance: await balanceFor(tx, userId) };
    const balance = await balanceFor(tx, userId) + 10;
    const [entry] = await tx.insert(rewardLedger).values({ userId, entryType: "earn", sourceType: "moment", amount: 10, balanceAfter: balance, idempotencyKey: claimKey, sourceId: postId, description: "Moment reward" }).returning();
    await tx.insert(rewardClaims).values({ userId, postId, ledgerEntryId: entry!.id, claimKey });
    return { ledger_entry_id: entry!.id, claimed: true, balance };
  });
  if (result.claimed) await createNotification({ userId, type: "reward", postId, dedupeKey: `reward:${result.ledger_entry_id}`, payload: { amount: 10, action: "claimed" } });
  return result;
}
export async function redeemCatalogReward(userId: string, catalogId: string) {
  const result = await getDb().transaction(async (tx) => {
    const [item] = await tx.select().from(rewardCatalog).where(and(eq(rewardCatalog.id, catalogId), eq(rewardCatalog.active, true))).limit(1);
    if (!item) throw new AppError(404, "NOT_FOUND", "The reward was not found.");
    const claimKey = `catalog:${catalogId}`;
    const [prior] = await tx.select({ ledgerEntryId: rewardClaims.ledgerEntryId }).from(rewardClaims).where(and(eq(rewardClaims.userId, userId), eq(rewardClaims.claimKey, claimKey))).limit(1);
    if (prior) return { ledger_entry_id: prior.ledgerEntryId, redeemed: false, balance: await balanceFor(tx, userId) };
    if (item.inventory !== null && item.inventory <= 0) throw new AppError(409, "CONFLICT", "This reward is no longer available.");
    const balance = await balanceFor(tx, userId);
    if (balance < item.costPoints) throw new AppError(422, "INSUFFICIENT_BALANCE", "Your Box balance is insufficient for this reward.");
    if (item.inventory !== null) await tx.update(rewardCatalog).set({ inventory: sql`${rewardCatalog.inventory} - 1`, updatedAt: new Date() }).where(and(eq(rewardCatalog.id, catalogId), sql`${rewardCatalog.inventory} > 0`));
    const next = balance - item.costPoints;
    const [entry] = await tx.insert(rewardLedger).values({ userId, entryType: "spend", sourceType: "catalog", amount: -item.costPoints, balanceAfter: next, idempotencyKey: claimKey, sourceId: item.id, description: `Redeemed ${item.title}` }).returning();
    await tx.insert(rewardClaims).values({ userId, catalogItemId: item.id, ledgerEntryId: entry!.id, claimKey });
    return { ledger_entry_id: entry!.id, redeemed: true, balance: next };
  });
  if (result.redeemed) await createNotification({ userId, type: "reward", dedupeKey: `reward:${result.ledger_entry_id}`, payload: { catalog_id: catalogId, action: "redeemed" } });
  return result;
}
