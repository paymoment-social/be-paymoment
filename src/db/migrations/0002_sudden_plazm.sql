ALTER TYPE "public"."job_status" ADD VALUE 'dead_lettered';--> statement-breakpoint
ALTER TYPE "public"."outbox_status" ADD VALUE 'dead_lettered';--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "max_attempts" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_attempts_check" CHECK ("outbox_events"."attempts" >= 0 and "outbox_events"."max_attempts" > 0 and "outbox_events"."attempts" <= "outbox_events"."max_attempts");