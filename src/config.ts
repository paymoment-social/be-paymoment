export function config() {
  const required = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AUTH_SECRET"] as const;
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
  }

  return {
    googleClientId: process.env.GOOGLE_CLIENT_ID!,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    authSecret: process.env.AUTH_SECRET!,
    frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:8787/api/auth/google/callback",
    port: Number(process.env.PORT ?? 8787),
    isProduction: process.env.NODE_ENV === "production",
  };
}
