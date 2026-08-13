UPDATE "user_profiles" SET "private_profile" = false WHERE "private_profile" = true;
UPDATE "follows" SET "status" = 'active', "updated_at" = now() WHERE "status" = 'pending';
