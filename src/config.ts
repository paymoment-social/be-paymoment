export function config() {
  return {
    databaseUrl: process.env.DATABASE_URL ?? "",
    redisUrl: process.env.REDIS_URL ?? "",
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    authSecret: process.env.AUTH_SECRET ?? "",
    authCookieDomain: process.env.AUTH_COOKIE_DOMAIN ?? "",
    frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:8787/api/v1/auth/google/callback",
    encryptionKey: process.env.ENCRYPTION_KEY ?? "",
    pinataJwt: process.env.PINATA_JWT ?? "",
    pinataGatewayUrl: process.env.PINATA_GATEWAY_URL ?? "https://gateway.pinata.cloud",
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
  assertValues([
    ["PINATA_JWT", value.pinataJwt],
    ["PINATA_GATEWAY_URL", value.pinataGatewayUrl],
  ]);
  return value;
}
