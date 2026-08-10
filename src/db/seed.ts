import { getDb, closeDatabase } from "./client";
import { interests, rewardCatalog, userProfiles, users } from "./schema";

const developmentUsers = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    email: "alex@paymoment.local",
    emailVerified: true,
    displayName: "Alex Morgan",
    username: "alexmorgan",
    usernameNormalized: "alexmorgan",
    onboardingCompleted: true,
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    email: "maya@paymoment.local",
    emailVerified: true,
    displayName: "Maya Chen",
    username: "mayachen",
    usernameNormalized: "mayachen",
    onboardingCompleted: true,
  },
] as const;

const developmentInterests = [
  ["technology", "Technology"],
  ["design", "Design"],
  ["business", "Business"],
  ["finance", "Finance"],
  ["music", "Music"],
  ["gaming", "Gaming"],
  ["travel", "Travel"],
  ["food", "Food"],
  ["sports", "Sports"],
  ["art", "Art"],
] as const;

const catalog = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    slug: "verified-badge",
    title: "Verified badge",
    description: "Unlock the PayMoment verified badge after earning 10,000 points.",
    costPoints: 10_000,
    inventory: null,
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    slug: "profile-highlight",
    title: "Profile highlight",
    description: "Highlight your profile for seven days.",
    costPoints: 2_500,
    inventory: null,
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    slug: "early-access-1000",
    title: "Early PayMoment Verified",
    description: "Claim 10,000 Box and get verified. Limited to the first 1,000 members.",
    costPoints: 0,
    inventory: 1_000,
    metadata: { campaign: "early-access-1000", grant_points: 10_000, verify: true, campaign_capacity: 1_000 },
  },
] as const;

const db = getDb();

try {
  await db.transaction(async (tx) => {
    await tx.insert(interests).values(developmentInterests.map(([slug, label]) => ({ slug, label })))
      .onConflictDoUpdate({ target: interests.slug, set: { active: true, updatedAt: new Date() } });

    await tx.insert(users).values([...developmentUsers])
      .onConflictDoUpdate({ target: users.id, set: { updatedAt: new Date() } });

    await tx.insert(userProfiles).values(developmentUsers.map((user) => ({
      userId: user.id,
      bio: `Development profile for ${user.displayName}.`,
    }))).onConflictDoNothing();

    await tx.insert(rewardCatalog).values([...catalog])
      .onConflictDoUpdate({ target: rewardCatalog.slug, set: { active: true, updatedAt: new Date() } });
  });
  console.info("Development seed completed successfully.");
} catch (error) {
  console.error("Development seed failed.", error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
