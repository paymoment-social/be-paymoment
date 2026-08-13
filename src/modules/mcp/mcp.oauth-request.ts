import { z } from "zod";
import { getRedis } from "../../integrations/redis";
import { redisKeys } from "../../integrations/redis/keys";
import { randomToken } from "../auth/session";

const pendingAuthorizationSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.url(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  scope: z.string().optional(),
  state: z.string().max(2048).optional(),
  resource: z.url().optional(),
});

export type PendingAuthorizationRequest = z.infer<typeof pendingAuthorizationSchema>;

export type OAuthRequestRedis = {
  set(key: string, value: string, expiryMode: "EX", ttlSeconds: number, mode: "NX"): Promise<unknown>;
  get(key: string): Promise<string | null>;
  call(command: "GETDEL", key: string): Promise<unknown>;
};

const REQUEST_TTL_SECONDS = 10 * 60;

export async function createPendingAuthorizationRequest(
  request: PendingAuthorizationRequest,
  client: OAuthRequestRedis = getRedis() as OAuthRequestRedis,
) {
  const requestId = randomToken(24);
  const parsed = pendingAuthorizationSchema.parse(request);
  const result = await client.set(
    redisKeys.oauthAuthorizationRequest(requestId),
    JSON.stringify(parsed),
    "EX",
    REQUEST_TTL_SECONDS,
    "NX",
  );
  if (result !== "OK") throw new Error("Unable to create an OAuth authorization request.");
  return { requestId, expiresIn: REQUEST_TTL_SECONDS };
}

function parsePendingAuthorization(value: string | null) {
  if (!value) return null;
  const parsed = pendingAuthorizationSchema.safeParse(JSON.parse(value));
  return parsed.success ? parsed.data : null;
}

export async function getPendingAuthorizationRequest(
  requestId: string,
  client: OAuthRequestRedis = getRedis() as OAuthRequestRedis,
) {
  const value = await client.get(redisKeys.oauthAuthorizationRequest(requestId));
  try {
    return parsePendingAuthorization(value);
  } catch {
    return null;
  }
}

export async function consumePendingAuthorizationRequest(
  requestId: string,
  client: OAuthRequestRedis = getRedis() as OAuthRequestRedis,
) {
  const value = await client.call("GETDEL", redisKeys.oauthAuthorizationRequest(requestId));
  if (typeof value !== "string") return null;
  try {
    return parsePendingAuthorization(value);
  } catch {
    return null;
  }
}
