INSERT INTO "reward_catalog" ("id", "slug", "title", "description", "cost_points", "inventory", "active", "metadata")
VALUES (
  '20000000-0000-4000-8000-000000000003',
  'early-access-1000',
  'Early PayMoment Verified',
  'Claim 10,000 Box and get verified. Limited to the first 1,000 members.',
  0,
  1000,
  true,
  '{"campaign":"early-access-1000","grant_points":10000,"verify":true,"campaign_capacity":1000}'::jsonb
)
ON CONFLICT ("slug") DO UPDATE SET
  "title" = EXCLUDED."title",
  "description" = EXCLUDED."description",
  "active" = true,
  "metadata" = "reward_catalog"."metadata" || '{"campaign_capacity":1000}'::jsonb,
  "updated_at" = now();
