import { getRedis } from "../../integrations/redis/client";
import { redisKeys } from "../../integrations/redis/keys";

const TRENDING_WINDOW = "24h";
const TRENDING_TTL_SECONDS = 26 * 60 * 60;

export async function recordTrendingHashtags(hashtags: string[]) {
  if (!hashtags.length) return;
  try {
    const redis = getRedis();
    const key = redisKeys.trending(TRENDING_WINDOW);
    const multi = redis.multi();
    for (const hashtag of hashtags) multi.zincrby(key, 1, hashtag);
    multi.expire(key, TRENDING_TTL_SECONDS);
    await multi.exec();
  } catch {
    // Redis ranking is an optimization. PostgreSQL remains the durable source.
  }
}

export async function readTrendingHashtags(limit: number) {
  try {
    const values = await getRedis().zrevrange(redisKeys.trending(TRENDING_WINDOW), 0, limit - 1, "WITHSCORES");
    const result: Array<{ slug: string; score: number }> = [];
    for (let index = 0; index < values.length; index += 2) {
      const slug = values[index];
      const rawScore = values[index + 1];
      if (slug && rawScore) result.push({ slug, score: Number(rawScore) });
    }
    return result;
  } catch {
    return [];
  }
}
