import { Hono } from "hono";
import type { Context } from "hono";
import { AppError } from "../../lib/errors";
import { enforceRateLimit } from "../../lib/rate-limit";
import { beginIdempotentRequest, completeIdempotentRequest, releaseIdempotentRequest } from "../../integrations/redis/idempotency";
import { success } from "../../lib/responses";
import { parseJson } from "../../lib/validation";
import { requireSession } from "../auth/auth.service";
import { rewardCampaignTopUpSchema } from "./rewards.schemas";
import { claimMomentReward, getRewardBalance, listRewardCatalog, listRewardLeaderboard, listRewardLedger, redeemCatalogReward, requireRewardAdmin, topUpRewardCampaign } from "./rewards.repository";

export const rewardsRoutes = new Hono();

async function idempotentReward<T>(c: Context, userId: string, scope: string, operation: () => Promise<T>) {
  const key = c.req.header("idempotency-key");
  if (!key) return operation();
  if (key.length > 128) throw new AppError(422, "VALIDATION_ERROR", "The idempotency key is too long.", { "Idempotency-Key": "Use 128 characters or fewer." });
  const request = await beginIdempotentRequest(scope, userId, key);
  if (!request.acquired) {
    if (request.record?.status === "completed") return request.record.response as T;
    throw new AppError(409, "CONFLICT", "An identical reward request is already being processed.");
  }
  try {
    const response = await operation();
    await completeIdempotentRequest(request.redisKey, 200, response);
    return response;
  } catch (error) {
    await releaseIdempotentRequest(request.redisKey);
    throw error;
  }
}
rewardsRoutes.get("/balance", async (c) => { const session = await requireSession(c); return success(c, { balance: await getRewardBalance(session.user.id) }); });
rewardsRoutes.get("/ledger", async (c) => { const session = await requireSession(c); return success(c, { entries: await listRewardLedger(session.user.id) }); });
rewardsRoutes.get("/catalog", async (c) => { const session = await requireSession(c); return success(c, { items: await listRewardCatalog(session.user.id) }); });
rewardsRoutes.get("/leaderboard", async (c) => { await requireSession(c); return success(c, { leaders: await listRewardLeaderboard() }); });
rewardsRoutes.post("/campaigns/:slug/top-up", async (c) => { const session = await requireSession(c); await requireRewardAdmin(session.user.id); const input = await parseJson(c, rewardCampaignTopUpSchema); return success(c, { campaign: await topUpRewardCampaign(session.user.id, c.req.param("slug"), input.amount, c.get("requestId")) }); });
rewardsRoutes.post("/moments/:id/claim", async (c) => { const session = await requireSession(c); await enforceRateLimit(c, "rewards.claim", session.user.id, 30, 60 * 60); return success(c, await idempotentReward(c, session.user.id, "rewards.claim", () => claimMomentReward(session.user.id, c.req.param("id")))); });
rewardsRoutes.post("/catalog/:id/redeem", async (c) => { const session = await requireSession(c); await enforceRateLimit(c, "rewards.redeem", session.user.id, 30, 60 * 60); return success(c, await idempotentReward(c, session.user.id, "rewards.redeem", () => redeemCatalogReward(session.user.id, c.req.param("id")))); });
