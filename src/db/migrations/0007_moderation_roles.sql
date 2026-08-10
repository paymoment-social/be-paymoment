CREATE TYPE "user_role" AS ENUM ('moderator', 'admin');--> statement-breakpoint
CREATE TABLE "user_roles" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "user_role" NOT NULL,
  "granted_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "role")
);--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" ("role", "user_id");
