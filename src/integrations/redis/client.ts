import Redis from "ioredis";
import { config } from "../../config";

let commandClient: Redis | undefined;
let publisherClient: Redis | undefined;
let subscriberClient: Redis | undefined;

function createRedisClient() {
  const redisUrl = config().redisUrl;
  if (!redisUrl) throw new Error("REDIS_URL is required to connect to Redis.");
  return new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    retryStrategy(times) {
      return Math.min(times * 100, 2_000);
    },
  });
}

export function getRedis() {
  commandClient ??= createRedisClient();
  return commandClient;
}

export function getRedisPublisher() {
  publisherClient ??= createRedisClient();
  return publisherClient;
}

export function getRedisSubscriber() {
  subscriberClient ??= createRedisClient();
  return subscriberClient;
}

async function disconnect(client: Redis | undefined) {
  if (!client) return;
  if (client.status === "ready") await client.quit();
  else client.disconnect();
}

export async function closeRedis() {
  await Promise.all([
    disconnect(commandClient),
    disconnect(publisherClient),
    disconnect(subscriberClient),
  ]);
  commandClient = undefined;
  publisherClient = undefined;
  subscriberClient = undefined;
}
