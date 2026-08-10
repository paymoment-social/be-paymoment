import { getRedis } from "./client";
import { redisKeys } from "./keys";

export const fixedWindowScript = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`;

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export type RateLimitRedis = {
  eval(script: string, keyCount: number, key: string, windowMilliseconds: string): Promise<unknown>;
};

export async function consumeRateLimit(scope: string, identity: string, limit: number, windowSeconds: number, client: RateLimitRedis = getRedis() as RateLimitRedis): Promise<RateLimitResult> {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1_000)).toString();
  const key = redisKeys.rateLimit(scope, identity, bucket);
  const result = await client.eval(fixedWindowScript, 1, key, String(windowSeconds * 1_000)) as [number, number];
  const [count, ttlMilliseconds] = result.map(Number) as [number, number];
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil(ttlMilliseconds / 1_000)),
  };
}
