import { getRedis } from "../../integrations/redis";
import { redisKeys } from "../../integrations/redis/keys";
import { challenge, createState, createVerifier } from "./session";

type OauthAttempt = {
  verifier: string;
  returnPath: string;
};

export function safeReturnPath(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const parsed = new URL(value, "https://paymoment.invalid");
    return parsed.origin === "https://paymoment.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/";
  } catch {
    return "/";
  }
}

export async function createOauthAttempt(returnPath?: string | null) {
  const state = createState();
  const verifier = createVerifier();
  const attempt: OauthAttempt = { verifier, returnPath: safeReturnPath(returnPath) };
  const result = await getRedis().set(redisKeys.oauthState(state), JSON.stringify(attempt), "EX", 600, "NX");
  if (result !== "OK") throw new Error("Unable to create an OAuth attempt.");
  return { state, verifier, codeChallenge: challenge(verifier), returnPath: attempt.returnPath };
}

export async function consumeOauthAttempt(state: string): Promise<OauthAttempt | null> {
  const value = await getRedis().call("GETDEL", redisKeys.oauthState(state));
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as OauthAttempt;
    if (!parsed.verifier) return null;
    return { verifier: parsed.verifier, returnPath: safeReturnPath(parsed.returnPath) };
  } catch {
    return null;
  }
}
