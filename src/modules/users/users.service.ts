import type { Context } from "hono";
import { z } from "zod";
import { AppError } from "../../lib/errors";
import { hashPrivateValue } from "../auth/session";
import type { OnboardingInput, UpdateProfileInput } from "./users.schemas";
import type { ProfileMutationData, UserProfileResult } from "./users.types";
import { cleanDisplayName, normalizeUsername, validateUsername } from "./username";
import {
  blockUser,
  getUserProfile,
  isBlockedByUser,
  listActiveInterests,
  listPendingFollowerIds,
  listRelationshipIds,
  muteUser,
  persistOnboarding,
  persistProfileUpdate,
  removeFollowRelationship,
  respondToFollowRequest,
  setFollowRelationship,
  unblockUser,
  unmuteUser,
  userIdByUsername,
  usernameIsAvailable,
} from "./users.repository";
import { createNotification, resolveFollowRequestNotification } from "../notifications/notifications.repository";

function clientIpHash(c: Context) {
  const ip = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() || c.req.header("cf-connecting-ip") || c.req.header("x-real-ip");
  return ip ? hashPrivateValue(ip) : null;
}

function mapDatabaseError(error: unknown): never {
  if (error && typeof error === "object" && "code" in error && error.code === "23505") {
    throw new AppError(409, "USERNAME_TAKEN", "This username is already in use.", { username: "Choose another username." });
  }
  throw error;
}

function validUserId(value: string) {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw new AppError(404, "NOT_FOUND", "The user was not found.");
  return result.data;
}

export async function getMyProfile(userId: string) {
  const profile = await getUserProfile(userId, userId);
  if (!profile) throw new AppError(404, "NOT_FOUND", "The user profile was not found.");
  return profile;
}

export async function getProfileByUsername(username: string, viewerId: string) {
  const targetId = await userIdByUsername(normalizeUsername(username));
  if (!targetId || await isBlockedByUser(targetId, viewerId)) throw new AppError(404, "NOT_FOUND", "The user profile was not found.");
  const profile = await getUserProfile(targetId, viewerId);
  if (!profile) throw new AppError(404, "NOT_FOUND", "The user profile was not found.");
  return profile;
}

export async function checkUsernameAvailability(username: string, currentUserId: string) {
  const normalized = validateUsername(username);
  return { username: normalized, available: await usernameIsAvailable(normalized, currentUserId) };
}

export async function completeOnboarding(c: Context, userId: string, input: OnboardingInput) {
  const current = await getMyProfile(userId);
  if (current.onboarding_completed) throw new AppError(409, "CONFLICT", "Onboarding has already been completed.");
  const consentTypes = new Set(input.policy_consents.map((consent) => consent.type));
  if (!consentTypes.has("terms") || !consentTypes.has("privacy")) {
    throw new AppError(422, "VALIDATION_ERROR", "Terms and privacy consent are required.", { policy_consents: "Accept both required policies." });
  }
  const normalized = validateUsername(input.username);
  if (!await usernameIsAvailable(normalized, userId)) throw new AppError(409, "USERNAME_TAKEN", "This username is already in use.", { username: "Choose another username." });
  const data: ProfileMutationData = {
    displayName: cleanDisplayName(input.display_name),
    username: normalized,
    usernameNormalized: normalized,
    bio: input.bio.trim(),
    birthDate: input.birth_date ?? null,
    interestSlugs: [...new Set(input.interest_slugs.map((slug) => slug.toLowerCase()))],
  };
  try {
    await persistOnboarding(userId, data, input.policy_consents, clientIpHash(c));
  } catch (error) {
    mapDatabaseError(error);
  }
  return getMyProfile(userId);
}

export async function updateMyProfile(userId: string, input: UpdateProfileInput) {
  const data: ProfileMutationData = {
    ...(input.display_name !== undefined ? { displayName: cleanDisplayName(input.display_name) } : {}),
    ...(input.bio !== undefined ? { bio: input.bio.trim() } : {}),
    ...(input.birth_date !== undefined ? { birthDate: input.birth_date } : {}),
    ...(input.location !== undefined ? { location: input.location?.trim() || null } : {}),
    ...(input.website_url !== undefined ? { websiteUrl: input.website_url || null } : {}),
    ...(input.podcast_url !== undefined ? { podcastUrl: input.podcast_url || null } : {}),
    ...(input.avatar_url !== undefined ? { avatarUrl: input.avatar_url || null } : {}),
    ...(input.cover_url !== undefined ? { coverUrl: input.cover_url || null } : {}),
    ...(input.cover_position !== undefined ? { coverPosition: input.cover_position } : {}),
    ...(input.interest_slugs !== undefined ? { interestSlugs: [...new Set(input.interest_slugs.map((slug) => slug.toLowerCase()))] } : {}),
    ...(input.show_paybox_badge !== undefined ? { showPayboxBadge: input.show_paybox_badge } : {}),
    ...(input.show_recent_views !== undefined ? { showRecentViews: input.show_recent_views } : {}),
    privateProfile: false,
    ...(input.allow_messages !== undefined ? { allowMessages: input.allow_messages } : {}),
  };
  if (input.username !== undefined) {
    const normalized = validateUsername(input.username);
    if (!await usernameIsAvailable(normalized, userId)) throw new AppError(409, "USERNAME_TAKEN", "This username is already in use.", { username: "Choose another username." });
    data.username = normalized;
    data.usernameNormalized = normalized;
  }
  try {
    await persistProfileUpdate(userId, data);
  } catch (error) {
    mapDatabaseError(error);
  }
  return getMyProfile(userId);
}

function assertDifferentUsers(actorId: string, targetValue: string) {
  const targetId = validUserId(targetValue);
  if (actorId === targetId) throw new AppError(422, "BUSINESS_RULE_ERROR", "You cannot perform this action on your own account.");
  return targetId;
}

export async function follow(actorId: string, targetValue: string) {
  const targetId = assertDifferentUsers(actorId, targetValue);
  const status = await setFollowRelationship(actorId, targetId);
  await createNotification({ userId: targetId, actorId, type: "follow", dedupeKey: `follow:${actorId}:${targetId}`, payload: { action: "following" } });
  return { user_id: targetId, following: true, requested: false, status };
}

export async function unfollow(actorId: string, targetValue: string) {
  const targetId = assertDifferentUsers(actorId, targetValue);
  await removeFollowRelationship(actorId, targetId);
  return { user_id: targetId, following: false, requested: false, status: "removed" as const };
}

export async function setBlocked(actorId: string, targetValue: string, blocked: boolean) {
  const targetId = assertDifferentUsers(actorId, targetValue);
  if (blocked) await blockUser(actorId, targetId); else await unblockUser(actorId, targetId);
  return { user_id: targetId, blocked };
}

export async function setMuted(actorId: string, targetValue: string, muted: boolean, expiresAt?: string | null) {
  const targetId = assertDifferentUsers(actorId, targetValue);
  if (muted) {
    const expiry = expiresAt ? new Date(expiresAt) : null;
    if (expiry && expiry <= new Date()) throw new AppError(422, "VALIDATION_ERROR", "Mute expiration must be in the future.", { expires_at: "Choose a future date and time." });
    await muteUser(actorId, targetId, expiry);
  } else await unmuteUser(actorId, targetId);
  return { user_id: targetId, muted, expires_at: muted ? expiresAt ?? null : null };
}

export async function respondFollowRequest(ownerId: string, followerValue: string, accepted: boolean) {
  const followerId = assertDifferentUsers(ownerId, followerValue);
  if (!await respondToFollowRequest(ownerId, followerId, accepted)) throw new AppError(404, "NOT_FOUND", "The follow request was not found.");
  await resolveFollowRequestNotification(ownerId, followerId, accepted);
  await createNotification({ userId: followerId, actorId: ownerId, type: "follow", dedupeKey: `follow-response:${ownerId}:${followerId}:${accepted ? "accepted" : "declined"}`, payload: { action: accepted ? "accepted" : "declined" } });
  return { user_id: followerId, status: accepted ? "active" as const : "removed" as const };
}

async function hydrateProfiles(ids: string[], viewerId: string) {
  const profiles = await Promise.all(ids.map((id) => getUserProfile(id, viewerId)));
  return profiles.filter((profile): profile is UserProfileResult => Boolean(profile));
}

export async function listRelationships(targetValue: string, direction: "followers" | "following", viewerId: string, limit: number, cursor?: string) {
  const targetId = validUserId(targetValue);
  if (await isBlockedByUser(targetId, viewerId)) throw new AppError(404, "NOT_FOUND", "The user was not found.");
  const page = await listRelationshipIds(targetId, direction, limit, cursor);
  return { ...page, profiles: await hydrateProfiles(page.ids, viewerId) };
}

export async function listFollowRequests(ownerId: string) {
  const rows = await listPendingFollowerIds(ownerId);
  return hydrateProfiles(rows.map((row) => row.id), ownerId);
}

export { listActiveInterests };
