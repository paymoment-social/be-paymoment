import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

let queryClient: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getQueryClient() {
  if (queryClient) return queryClient;
  const databaseUrl = config().databaseUrl;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to connect to PostgreSQL.");
  queryClient = postgres(databaseUrl, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return queryClient;
}

export function getDb() {
  if (!database) database = drizzle(getQueryClient(), { schema });
  return database;
}

export async function closeDatabase() {
  if (!queryClient) return;
  await queryClient.end({ timeout: 5 });
  queryClient = undefined;
  database = undefined;
}
