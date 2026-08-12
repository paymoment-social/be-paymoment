import { z } from "zod";

const optionalUrl = z.union([z.url("Enter a valid URL."), z.literal(""), z.null()]).optional();
const username = z.string().trim().min(3, "Username must contain at least 3 characters.").max(30, "Username cannot exceed 30 characters.");
const displayName = z.string().min(1, "Display name is required.").max(80, "Display name cannot exceed 80 characters.");
const bio = z.string().max(160, "Bio cannot exceed 160 characters.");
const interestSlugs = z.array(z.string().trim().min(1).max(80)).max(10, "Select no more than 10 interests.");
const coverPosition = z.enum(["top", "center", "bottom"]);

export const onboardingSchema = z.object({
  display_name: displayName,
  username,
  bio: bio.default(""),
  birth_date: z.union([z.iso.date(), z.null()]).optional(),
  interest_slugs: interestSlugs.default([]),
  policy_consents: z.array(z.object({
    type: z.enum(["terms", "privacy"]),
    version: z.string().trim().min(1).max(32),
  })).length(2, "Terms and privacy consent are required."),
});

export const updateProfileSchema = z.object({
  display_name: displayName.optional(),
  username: username.optional(),
  bio: bio.optional(),
  birth_date: z.union([z.iso.date(), z.null()]).optional(),
  location: z.union([z.string().max(120), z.null()]).optional(),
  website_url: optionalUrl,
  podcast_url: optionalUrl,
  avatar_url: optionalUrl,
  cover_url: optionalUrl,
  cover_position: coverPosition.optional(),
  interest_slugs: interestSlugs.optional(),
  show_paybox_badge: z.boolean().optional(),
  show_recent_views: z.boolean().optional(),
  private_profile: z.boolean().optional(),
  allow_messages: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export const muteUserSchema = z.object({
  expires_at: z.union([z.iso.datetime(), z.null()]).optional(),
});

export const listUsersQuerySchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
