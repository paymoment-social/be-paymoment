ALTER TABLE "follows" ADD CONSTRAINT "follows_not_self_check" CHECK ("follows"."follower_id" <> "follows"."following_id");--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_not_self_check" CHECK ("user_blocks"."blocker_id" <> "user_blocks"."blocked_id");--> statement-breakpoint
ALTER TABLE "user_mutes" ADD CONSTRAINT "user_mutes_not_self_check" CHECK ("user_mutes"."muter_id" <> "user_mutes"."muted_id");--> statement-breakpoint
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_position_nonnegative_check" CHECK ("poll_options"."position" >= 0);--> statement-breakpoint
ALTER TABLE "poll_options" ADD CONSTRAINT "poll_options_votes_nonnegative_check" CHECK ("poll_options"."vote_count" >= 0);--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_position_nonnegative_check" CHECK ("post_media"."position" >= 0);--> statement-breakpoint
ALTER TABLE "post_replies" ADD CONSTRAINT "post_replies_counts_nonnegative_check" CHECK ("post_replies"."like_count" >= 0 and "post_replies"."reply_count" >= 0);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_version_positive_check" CHECK ("posts"."version" > 0);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_counts_nonnegative_check" CHECK ("posts"."like_count" >= 0 and "posts"."reply_count" >= 0 and "posts"."repost_count" >= 0 and "posts"."bookmark_count" >= 0 and "posts"."view_count" >= 0);--> statement-breakpoint
ALTER TABLE "reply_media" ADD CONSTRAINT "reply_media_position_nonnegative_check" CHECK ("reply_media"."position" >= 0);--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_attempts_check" CHECK ("background_jobs"."attempts" >= 0 and "background_jobs"."max_attempts" > 0 and "background_jobs"."attempts" <= "background_jobs"."max_attempts");--> statement-breakpoint
ALTER TABLE "reward_catalog" ADD CONSTRAINT "reward_catalog_cost_nonnegative_check" CHECK ("reward_catalog"."cost_points" >= 0);--> statement-breakpoint
ALTER TABLE "reward_catalog" ADD CONSTRAINT "reward_catalog_inventory_nonnegative_check" CHECK ("reward_catalog"."inventory" is null or "reward_catalog"."inventory" >= 0);--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_amount_nonzero_check" CHECK ("reward_ledger"."amount" <> 0);--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_balance_nonnegative_check" CHECK ("reward_ledger"."balance_after" >= 0);