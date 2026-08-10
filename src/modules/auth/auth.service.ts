import type { Context } from "hono";
import { AppError } from "../../lib/errors";
import type { SessionUser } from "../../contracts/auth";
import {
  createDatabaseSession,
  resolveSessionByTokenHash,
  revokeSessionByTokenHash,
  upsertGoogleIdentity,
  type GoogleIdentity,
} from "./auth.repository";
import {
  hashPrivateValue,
  hashToken,
  randomToken,
  SESSION_TTL_SECONDS,
  sessionCookie,
} from "./session";

export type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
};

function normalizedDisplayName(value: string, fallbackEmail: string) {
  const cleaned = value.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || fallbackEmail.split("@")[0] || "PayMoment user").slice(0, 80);
}

export function clientMetadata(c: Context) {
  // Caddy appends the direct client address to X-Forwarded-For. The first
  // value may be supplied by an untrusted client and must not key rate limits.
  const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
  const ip = forwarded || c.req.header("cf-connecting-ip") || c.req.header("x-real-ip");
  return {
    userAgent: c.req.header("user-agent")?.slice(0, 1024) ?? null,
    ipHash: ip ? hashPrivateValue(ip) : null,
  };
}

export async function establishGoogleSession(c: Context, profile: GoogleProfile) {
  if (!profile.emailVerified) throw new AppError(403, "FORBIDDEN", "A verified Google email address is required.");
  const identity: GoogleIdentity = {
    providerAccountId: profile.sub,
    email: profile.email.trim().toLowerCase(),
    emailVerified: profile.emailVerified,
    displayName: normalizedDisplayName(profile.name, profile.email),
    avatarUrl: profile.picture,
  };
  const user = await upsertGoogleIdentity(identity);
  if (!user) throw new Error("Unable to resolve the authenticated user.");

  const previousToken = sessionCookie(c);
  if (previousToken) await revokeSessionByTokenHash(hashToken(previousToken));

  const rawToken = randomToken(32);
  await createDatabaseSession(user.id, {
    tokenHash: hashToken(rawToken),
    ...clientMetadata(c),
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1_000),
  });
  return rawToken;
}

export async function currentSession(c: Context): Promise<{ sessionId: string; user: SessionUser } | null> {
  const rawToken = sessionCookie(c);
  return rawToken ? resolveSessionByTokenHash(hashToken(rawToken)) : null;
}

export async function requireSession(c: Context) {
  const session = await currentSession(c);
  if (!session) throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
  return session;
}

export async function revokeCurrentSession(c: Context) {
  const rawToken = sessionCookie(c);
  if (rawToken) await revokeSessionByTokenHash(hashToken(rawToken));
}
