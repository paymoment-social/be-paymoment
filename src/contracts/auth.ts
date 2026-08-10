import { z } from "zod";
import { successSchema, uuidSchema } from "./common";

export const entitlementSchema = z.object({
  verified: z.boolean(),
  verified_at: z.iso.datetime().nullable(),
  points_balance: z.number().int().nonnegative(),
  verified_threshold: z.number().int().positive(),
});

export const platformRoleSchema = z.enum(["moderator", "admin"]);

export const sessionUserSchema = z.object({
  id: uuidSchema,
  email: z.email(),
  display_name: z.string().min(1).max(80),
  username: z.string().min(3).max(30).nullable(),
  avatar_url: z.url().nullable(),
  onboarding_completed: z.boolean(),
  roles: z.array(platformRoleSchema),
  entitlement: entitlementSchema,
});

export const sessionDataSchema = z.object({
  user: sessionUserSchema,
});

export const sessionResponseSchema = successSchema(sessionDataSchema);
export const logoutResponseSchema = successSchema(z.object({ logged_out: z.literal(true) }));

export type SessionUser = z.infer<typeof sessionUserSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
