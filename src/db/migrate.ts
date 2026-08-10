import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDatabase, getDb } from "./client";

try {
  await migrate(getDb(), { migrationsFolder: "./src/db/migrations" });
  console.info("Database migrations completed successfully.");
} catch (error) {
  console.error("Database migration failed.", error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
