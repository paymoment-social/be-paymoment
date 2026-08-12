export function config() {
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
  const frontendUrls = Array.from(new Set([frontendUrl, ...(process.env.FRONTEND_URLS ?? "").split(",").map((value) => value.trim()).filter(Boolean)]));
  const cookieSameSite = process.env.AUTH_COOKIE_SAMESITE === "none" ? "none" : "lax";
  return {
    databaseUrl: process.env.DATABASE_URL ?? "",
    redisUrl: process.env.REDIS_URL ?? "",
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    authSecret: process.env.AUTH_SECRET ?? "",
    authCookieDomain: process.env.AUTH_COOKIE_DOMAIN ?? "",
    frontendUrl,
    frontendUrls,
    authCookieSameSite: cookieSameSite as "lax" | "none",
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:8787/api/v1/auth/google/callback",
    encryptionKey: process.env.ENCRYPTION_KEY ?? "",
    pinataJwt: process.env.PINATA_JWT ?? "",
    pinataGatewayUrl: process.env.PINATA_GATEWAY_URL ?? "https://gateway.pinata.cloud",
    r2Endpoint: process.env.R2_ENDPOINT ?? "",
    r2Bucket: process.env.R2_BUCKET ?? "",
    r2Region: process.env.R2_REGION ?? "auto",
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    r2PublicUrl: process.env.R2_PUBLIC_URL ?? "",
    mcpIssuerUrl: process.env.MCP_ISSUER_URL ?? "http://localhost:8787",
    port: Number(process.env.PORT ?? 8787),
    isProduction: process.env.NODE_ENV === "production",
  };
}

function assertValues(keys: Array<[string, string]>) {
  const missing = keys.filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

export function assertInfrastructureConfigured() {
  const value = config();
  assertValues([
    ["DATABASE_URL", value.databaseUrl],
    ["REDIS_URL", value.redisUrl],
  ]);
  return value;
}

export function assertAuthConfigured() {
  const value = config();
  assertValues([
    ["GOOGLE_CLIENT_ID", value.googleClientId],
    ["GOOGLE_CLIENT_SECRET", value.googleClientSecret],
    ["AUTH_SECRET", value.authSecret],
  ]);
  return value;
}

export function assertMediaConfigured() {
  const value = config();
  if (value.r2Endpoint || value.r2Bucket || value.r2AccessKeyId || value.r2SecretAccessKey || value.r2PublicUrl) {
    assertValues([
      ["R2_ENDPOINT", value.r2Endpoint],
      ["R2_BUCKET", value.r2Bucket],
      ["R2_ACCESS_KEY_ID", value.r2AccessKeyId],
      ["R2_SECRET_ACCESS_KEY", value.r2SecretAccessKey],
      ["R2_PUBLIC_URL", value.r2PublicUrl],
    ]);
    return { ...value, mediaProvider: "r2" as const };
  }
  assertValues([
    ["PINATA_JWT", value.pinataJwt],
    ["PINATA_GATEWAY_URL", value.pinataGatewayUrl],
  ]);
  return { ...value, mediaProvider: "pinata" as const };
}

export function assertPinataConfigured() {
  const value = config();
  assertValues([
    ["PINATA_JWT", value.pinataJwt],
    ["PINATA_GATEWAY_URL", value.pinataGatewayUrl],
  ]);
  return value;
}

export function assertDataProtectionConfigured() {
  const value = config();
  if (!value.encryptionKey) throw new Error("Missing required environment variable: ENCRYPTION_KEY");
  return value;
}
