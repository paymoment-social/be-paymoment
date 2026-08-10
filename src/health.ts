import { sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { getRedis } from "./integrations/redis";

export type ReadinessResult = {
  ok: boolean;
  checks: {
    postgres: "up" | "down";
    redis: "up" | "down";
  };
};

export async function checkReadiness(): Promise<ReadinessResult> {
  const checks: ReadinessResult["checks"] = { postgres: "down", redis: "down" };
  await Promise.allSettled([
    getDb().execute(sql`select 1`).then(() => { checks.postgres = "up"; }),
    getRedis().ping().then((response) => { if (response === "PONG") checks.redis = "up"; }),
  ]);
  return { ok: checks.postgres === "up" && checks.redis === "up", checks };
}
