ALTER TYPE "public"."media_purpose" ADD VALUE IF NOT EXISTS 'cover';--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "cover_url" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "cover_position" varchar(16) DEFAULT 'center' NOT NULL;
