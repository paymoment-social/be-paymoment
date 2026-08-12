export type RelationshipState = "none" | "pending" | "following" | "blocked" | "muted";

export type UserProfileResult = {
  id: string;
  email?: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  cover_position: "top" | "center" | "bottom";
  bio: string;
  birth_date?: string | null;
  location: string | null;
  website_url: string | null;
  podcast_url: string | null;
  interests: Array<{ slug: string; label: string }>;
  followers_count: number;
  following_count: number;
  onboarding_completed: boolean;
  joined_at: string;
  privacy: {
    show_paybox_badge: boolean;
    show_recent_views: boolean;
    private_profile: boolean;
    allow_messages: boolean;
  };
  entitlement: {
    verified: boolean;
    verified_at: string | null;
    points_balance: number;
    verified_threshold: number;
  };
  relationship: RelationshipState;
  is_self: boolean;
};

export type ProfileMutationData = {
  displayName?: string;
  username?: string;
  usernameNormalized?: string;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  coverPosition?: "top" | "center" | "bottom";
  bio?: string;
  birthDate?: string | null;
  location?: string | null;
  websiteUrl?: string | null;
  podcastUrl?: string | null;
  interestSlugs?: string[];
  showPayboxBadge?: boolean;
  showRecentViews?: boolean;
  privateProfile?: boolean;
  allowMessages?: boolean;
};
