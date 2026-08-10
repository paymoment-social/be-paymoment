import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://paymoment:paymoment@127.0.0.1:5432/paymoment",
  },
  strict: true,
  verbose: true,
});
