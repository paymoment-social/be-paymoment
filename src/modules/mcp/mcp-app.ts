import { App } from "@modelcontextprotocol/ext-apps";
import logoUrl from "./paymoment.png";
import boxLogoUrl from "./payboxlogo.png";
import verifiedIconUrl from "./verified-fill.svg";

type Card = {
  id?: string;
  body?: string;
  author?: { display_name?: string; username?: string; avatar_url?: string; verified?: boolean; entitlement?: { verified?: boolean } };
  media?: Array<{ url?: string; alt_text?: string; mime_type?: string }>;
  counts?: { likes?: number; replies?: number; reposts?: number };
};

type ToolResult = {
  structuredContent?: { type?: string; card?: Card; cards?: Card[]; profile?: Profile; reward?: { title?: string; balance?: number; claimed?: boolean; redeemed?: boolean; unit?: string; granted_points?: number }; action?: { title?: string; data?: unknown }; results?: { people?: unknown[]; moments?: Card[]; articles?: Card[]; topics?: unknown[] }; notifications?: NotificationItem[]; conversations?: ConversationItem[]; filter?: string; brand?: { name?: string; website?: string }; pagination?: { next_cursor?: string | null; has_more?: boolean } };
};

type NotificationItem = {
  id?: string;
  type?: "like" | "reply" | "follow" | "reward" | "mention" | "repost" | "message" | "system";
  actor?: { id?: string; display_name?: string; username?: string | null; avatar_url?: string | null; verified?: boolean } | null;
  text?: string;
  href?: string;
  read?: boolean;
  created_at?: string;
  reward_amount?: number;
  reward_action?: "earned" | "redeemed";
  follow_action?: string;
};

type ConversationItem = {
  id?: string;
  type?: string;
  title?: string | null;
  participant?: { id?: string; display_name?: string; username?: string | null; avatar_url?: string | null; verified?: boolean } | null;
  last_message?: { body?: string; created_at?: string; is_from_me?: boolean } | null;
  unread?: boolean;
  updated_at?: string;
  href?: string;
};

type Profile = {
  id?: string;
  display_name?: string;
  username?: string | null;
  avatar_url?: string | null;
  cover_url?: string | null;
  cover_position?: "top" | "center" | "bottom" | null;
  bio?: string;
  location?: string | null;
  website_url?: string | null;
  interests?: Array<{ label?: string; slug?: string }>;
  followers_count?: number;
  following_count?: number;
  joined_at?: string;
  entitlement?: { verified?: boolean; points_balance?: number };
};

const app = new App({ name: "PayMoment Social", version: "1.4.0" });
const root = document.querySelector<HTMLElement>("#app")!;

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
const safeUrl = (value: unknown) => {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
};

const verifiedMarkup = `<img class="verified" src="${verifiedIconUrl}" title="Verified PayMoment account" aria-label="Verified account" alt="Verified" />`;

function styles() {
  return `<style>
  :root{color-scheme:dark;font:13px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#08090a;color:#f5f5f7}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 90% 0,#8056e825,transparent 38%),#08090a}.shell{max-width:560px;margin:auto;padding:12px}.header{display:flex;align-items:center;gap:9px;margin-bottom:10px}.brand-logo{display:block;width:118px;height:28px;object-fit:contain;object-position:left center}.eyebrow{margin-left:auto;color:#a6a6ad;font-size:10px;letter-spacing:.08em;text-transform:uppercase}.toolbar{display:flex;align-items:center;gap:8px;margin-bottom:9px}.button{min-height:40px;border:1px solid #292a2f;border-radius:12px;background:#17181b;color:#f5f5f7;padding:0 12px;font:inherit;font-weight:650;cursor:pointer;transition:border-color 100ms ease-out,background-color 100ms ease-out}.button:hover{border-color:#8056e8}.button:focus-visible{outline:2px solid #b8a2ff;outline-offset:2px}.button.primary{border-color:transparent;background:linear-gradient(100deg,#b8a2ff,#8056e8);color:#100c17}.button:disabled{cursor:wait;opacity:.7}.cards{display:grid;gap:9px}.card,.profile-card,.reward-card,.notification-panel{overflow:hidden;border:1px solid #292a2f;border-radius:16px;background:#101113}.card-head{display:flex;align-items:center;gap:9px;padding:12px 13px 8px}.avatar{display:block;width:34px;height:34px;border-radius:50%;object-fit:cover;background:#292a2f}.author{min-width:0}.name{display:flex;align-items:center;min-width:0;font-weight:720;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.handle{color:#a6a6ad;font-size:11px}.body{padding:0 13px 11px;white-space:pre-wrap;word-break:break-word}.media-wrap{position:relative;min-height:72px;background:#17181b}.media{display:block;width:100%;max-height:290px;object-fit:cover;background:#17181b}.media-fallback{display:none;min-height:72px;place-items:center;padding:16px;color:#a6a6ad;text-align:center}.media-wrap.failed .media{display:none}.media-wrap.failed .media-fallback{display:grid}.stats{display:flex;align-items:center;gap:11px;padding:9px 13px;color:#a6a6ad;font-size:11px;border-top:1px solid #292a2f}.card-actions{display:flex;gap:8px;margin-left:auto}.small{min-height:40px;padding:0 11px;border-radius:10px;font-size:11px}.empty{padding:22px 13px;text-align:center;color:#a6a6ad;border:1px dashed #292a2f;border-radius:16px}.empty-icon{display:grid;width:42px;height:42px;margin:0 auto 10px;place-items:center;border-radius:50%;background:#8056e81f;color:#b8a2ff}.empty strong{display:block;margin-bottom:3px;color:#f5f5f7}.status{min-height:18px;color:#a6a6ad;font-size:11px}.reward-card{display:flex;align-items:center;gap:12px;padding:16px}.reward-icon{width:42px;height:42px;object-fit:contain;padding:7px;border-radius:14px;background:#17181b}.reward-label{color:#a6a6ad;font-size:11px;text-transform:uppercase;letter-spacing:.08em}.reward-amount{font-size:25px;font-weight:800;letter-spacing:-.04em}.reward-amount span{font-size:12px;color:#b8a2ff}.reward-title{color:#a6a6ad;font-size:12px}.profile-cover{height:76px;background:linear-gradient(120deg,#2b214a,#8056e8 55%,#b8a2ff);background-size:cover}.profile-content{padding:0 15px 15px}.profile-top{display:flex;align-items:flex-end;justify-content:space-between;margin-top:-26px}.profile-avatar{display:block;width:62px;height:62px;border:4px solid #101113;border-radius:50%;object-fit:cover;background:#292a2f}.profile-actions{display:flex;gap:8px;padding-bottom:3px}.profile-name{margin-top:10px;font-size:18px}.verified{display:inline-block;flex:0 0 auto;width:16px;height:16px;margin-left:5px;border:0;border-radius:0;background:transparent;object-fit:contain}.profile-bio{margin:10px 0;color:#d6d2dc;white-space:pre-wrap}.profile-stats{display:flex;gap:13px;padding:10px 0;border-top:1px solid #292a2f;border-bottom:1px solid #292a2f;color:#a6a6ad;font-size:11px}.profile-stats strong{color:#f5f5f7;font-size:13px}.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.tag{padding:4px 8px;border-radius:999px;background:#8056e81f;color:#c5b7ff;font-size:11px}.profile-meta{display:flex;gap:12px;margin-top:11px;color:#a6a6ad;font-size:11px}.profile-meta a{color:#b8a2ff}.notification-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 13px;border-bottom:1px solid #292a2f;color:#a6a6ad;font-size:11px}.notification-count{display:inline-flex;align-items:center;gap:6px}.notification-count::before{width:6px;height:6px;border-radius:50%;background:#b8a2ff;content:""}.notification-item{display:flex;width:100%;min-height:72px;align-items:center;gap:11px;padding:12px 13px;border:0;border-bottom:1px solid #292a2f;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer;transition:background-color 100ms ease-out}.notification-item:last-of-type{border-bottom:0}.notification-item:hover{background:#17181b}.notification-item:focus-visible{position:relative;z-index:1;outline:2px solid #b8a2ff;outline-offset:-2px}.notification-item.unread{background:#8056e80d}.notification-avatar,.notification-glyph{display:grid;flex:0 0 auto;width:40px;height:40px;place-items:center;border-radius:50%;background:#25222f;color:#b8a2ff}.notification-avatar{object-fit:cover}.notification-glyph.reward{background:#07382d;color:#31e6b0}.notification-content{min-width:0;flex:1}.notification-copy{margin:0;color:#eeeaf4;line-height:1.45}.notification-copy strong{font-weight:720;color:#fff}.notification-meta{display:flex;align-items:center;gap:6px;margin-top:4px;color:#aaa6b0;font-size:11px}.notification-reward{display:inline-flex;margin-top:7px;padding:3px 8px;border:1px solid #1c644f;border-radius:999px;background:#083328;color:#59f2bd;font:700 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.notification-side{display:flex;flex:0 0 auto;align-items:center;gap:8px;color:#b8a2ff}.notification-side.reward{color:#31e6b0}.notification-icon{width:19px;height:19px}.unread-dot{width:7px;height:7px;border-radius:50%;background:#b8a2ff}.notification-footer{padding:10px 13px;border-top:1px solid #292a2f}.notification-footer .button{width:100%}.conversation-name{display:flex;align-items:center;min-width:0;color:#fff;font-weight:720}.conversation-preview{display:block;margin-top:3px;overflow:hidden;color:#d4d0da;white-space:nowrap;text-overflow:ellipsis}.conversation-prefix{color:#a6a6ad}.skeleton-panel{padding:2px 0}.skeleton-row{display:flex;align-items:center;gap:11px;min-height:72px;padding:12px 13px;border-bottom:1px solid #292a2f}.skeleton-row:last-child{border-bottom:0}.skeleton-avatar,.skeleton-line{background:#24252a;animation:pulse 1.3s ease-in-out infinite}.skeleton-avatar{width:40px;height:40px;flex:0 0 auto;border-radius:50%}.skeleton-copy{display:grid;flex:1;gap:7px}.skeleton-line{height:10px;border-radius:999px}.skeleton-line.short{width:42%;height:8px}@keyframes pulse{50%{opacity:.45}}.error{color:#ff8a98}@media(max-width:480px){.shell{padding:10px}.stats{align-items:flex-start;flex-wrap:wrap}.card-actions{width:100%;margin-left:0}.small{flex:1}.profile-stats{gap:9px}.notification-item{padding:11px}.notification-avatar,.notification-glyph{width:38px;height:38px}.notification-summary{align-items:flex-start;flex-direction:column}}
  @media(prefers-reduced-motion:reduce){.button,.notification-item{transition:none}.skeleton-avatar,.skeleton-line{animation:none}}
  </style>`;
}

function cardMarkup(card: Card, website?: string) {
  const author = card.author ?? {};
  const media = card.media?.find((item) => safeUrl(item.url));
  const avatar = safeUrl(author.avatar_url);
  const postUrl = card.id && safeUrl(website) ? `${safeUrl(website).replace(/\/$/, "")}/post/${encodeURIComponent(card.id)}` : "";
  const avatarMarkup = `<img class="avatar" src="${escapeHtml(avatar || boxLogoUrl)}" alt="PayBox avatar" onerror="this.onerror=null;this.src='${escapeHtml(boxLogoUrl)}'" />`;
  const verified = (author.verified || author.entitlement?.verified) ? verifiedMarkup : "";
  const mediaElement = media?.mime_type?.startsWith("video/") ? `<video class="media" src="${escapeHtml(safeUrl(media.url))}" controls playsinline preload="metadata"></video>` : media ? `<img class="media" src="${escapeHtml(safeUrl(media.url))}" alt="${escapeHtml(media.alt_text || "PayMoment attachment")}" />` : "";
  const mediaMarkup = mediaElement ? `<div class="media-wrap">${mediaElement}<div class="media-fallback" role="status">Media preview unavailable. Open the Moment to view it.</div></div>` : "";
  return `<article class="card"><div class="card-head">${avatarMarkup}<div class="author"><div class="name">${escapeHtml(author.display_name || "PayMoment user")}${verified}</div><div class="handle">@${escapeHtml(author.username || "paymoment.user")}</div></div></div><div class="body">${escapeHtml(card.body || "")}</div>${mediaMarkup}<div class="stats"><span>Likes ${card.counts?.likes ?? 0}</span><span>Replies ${card.counts?.replies ?? 0}</span><span>Reposts ${card.counts?.reposts ?? 0}</span><div class="card-actions">${postUrl ? `<button class="button small" data-open="${escapeHtml(postUrl)}">Open</button><button class="button small" data-copy="${escapeHtml(postUrl)}">Copy link</button>` : ""}</div></div></article>`;
}

function profileMarkup(profile: Profile, website?: string) {
  const avatar = safeUrl(profile.avatar_url);
  const profileUrl = profile.username && safeUrl(website) ? `${safeUrl(website).replace(/\/$/, "")}/u/${encodeURIComponent(profile.username)}` : "";
  const interests = profile.interests?.map((interest) => `<span class="tag">#${escapeHtml(interest.label || interest.slug)}</span>`).join("") || "";
  const profileAvatar = safeUrl(profile.avatar_url) || boxLogoUrl;
  const cover = safeUrl(profile.cover_url);
  const coverPosition = profile.cover_position === "top" || profile.cover_position === "bottom" ? profile.cover_position : "center";
  const coverStyle = cover ? ` style="background-image:url('${escapeHtml(cover)}');background-position:${coverPosition};background-size:cover"` : "";
  const verified = profile.entitlement?.verified ? verifiedMarkup : "";
  return `<article class="profile-card"><div class="profile-cover"${coverStyle}></div><div class="profile-content"><div class="profile-top"><img class="profile-avatar" src="${escapeHtml(profileAvatar)}" alt="PayMoment avatar" onerror="this.onerror=null;this.src='${escapeHtml(boxLogoUrl)}'" /><div class="profile-actions">${profileUrl ? `<button class="button small" data-open="${escapeHtml(profileUrl)}">Open profile</button><button class="button small" data-copy="${escapeHtml(profileUrl)}">Copy link</button>` : ""}</div></div><div class="name profile-name">${escapeHtml(profile.display_name || "PayMoment user")}${verified}</div><div class="handle">@${escapeHtml(profile.username || "paymoment.user")}</div>${profile.bio ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>` : ""}<div class="profile-stats"><span><strong>${profile.followers_count ?? 0}</strong> followers</span><span><strong>${profile.following_count ?? 0}</strong> following</span><span><strong>${profile.entitlement?.points_balance ?? 0}</strong> points</span></div>${interests ? `<div class="tags">${interests}</div>` : ""}${profile.location || profile.website_url ? `<div class="profile-meta">${profile.location ? `<span>Location: ${escapeHtml(profile.location)}</span>` : ""}${safeUrl(profile.website_url) ? `<a href="${escapeHtml(safeUrl(profile.website_url))}" target="_blank" rel="noreferrer">Website</a>` : ""}</div>` : ""}</div></article>`;
}

function rewardMarkup(reward: NonNullable<ToolResult["structuredContent"]>["reward"]) {
  if (!reward) return "";
  const label = reward.claimed === false ? "Already claimed" : reward.claimed ? "Box earned" : "Box balance";
  const earned = reward.claimed && reward.granted_points ? `<span class="reward-earned">+${escapeHtml(reward.granted_points)} Box earned</span>` : "";
  return `<article class="reward-card"><img class="reward-icon" src="${escapeHtml(boxLogoUrl)}" alt="PayBox" /><div><div class="reward-label">${escapeHtml(label)}</div><div class="reward-amount">${escapeHtml(reward.balance ?? 0)} <span>${escapeHtml(reward.unit || "Box")}</span></div>${earned}<div class="reward-title">${escapeHtml(reward.title || "PayMoment Box")}</div></div></article>`;
}

function actionMarkup(action: NonNullable<ToolResult["structuredContent"]>["action"]) {
  return `<article class="card"><div class="card-head"><img class="avatar" src="${escapeHtml(logoUrl)}" alt="PayMoment" /><div class="author"><div class="name">${escapeHtml(action?.title || "PayMoment updated")}</div><div class="handle">Your change has been saved</div></div></div><div class="body">This action is now reflected in your PayMoment account.</div></article>`;
}

function relativeTime(value?: string) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  if (!Number.isFinite(timestamp)) return "Recently";
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "Now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(timestamp));
}

function notificationIcon(type?: NotificationItem["type"]) {
  const paths: Record<NonNullable<NotificationItem["type"]>, string> = {
    like: '<path d="M12 21s-7.2-4.45-9.33-8.42C.97 9.4 2.43 5.5 6.17 4.76A5.58 5.58 0 0 1 12 7.05a5.58 5.58 0 0 1 5.83-2.29c3.74.74 5.2 4.64 3.5 7.82C19.2 16.55 12 21 12 21Z" fill="currentColor"/>',
    reply: '<path d="M20.5 11.5a8.5 8.5 0 0 1-11.92 7.78L3 21l1.72-5.58A8.5 8.5 0 1 1 20.5 11.5Z" fill="currentColor"/><path d="M8 12h8M8 9h5" stroke="#101113" stroke-width="1.5" stroke-linecap="round"/>',
    follow: '<path d="M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.14 0-7.5 2.46-7.5 5.5V20h10.2a6.5 6.5 0 0 1-.2-1.5c0-2.15 1.04-4.06 2.64-5.25A11.6 11.6 0 0 0 9.5 13Z" fill="currentColor"/><path d="M18 15v6m-3-3h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    reward: '<path d="m4 7 8-4 8 4-8 4-8-4Zm0 2.5 7 3.5v8l-7-3.5v-8Zm16 0L13 13v8l7-3.5v-8Z" fill="currentColor"/>',
    mention: '<path d="M16.7 16.7A6.5 6.5 0 1 1 18.5 12v1.2a2.3 2.3 0 0 1-4.6 0V8.5m0 3.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    repost: '<path d="m7 7 3-3m-3 3 3 3M7 7h9a3 3 0 0 1 3 3v1M17 17l-3 3m3-3-3-3m3 3H8a3 3 0 0 1-3-3v-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    message: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11Z" fill="currentColor"/><path d="m5 7 7 5 7-5" fill="none" stroke="#101113" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    system: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8.5h18C21 16 18 16 18 9Zm-8.5 11h5a2.75 2.75 0 0 1-5 0Z" fill="currentColor"/>',
  };
  return `<svg class="notification-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[type || "system"]}</svg>`;
}

function notificationMarkup(notifications: NotificationItem[] | undefined, website?: string, filter = "all", hasMore = false) {
  const items = notifications ?? [];
  if (!items.length) return `<div class="empty"><span class="empty-icon">${notificationIcon("system")}</span><strong>You're all caught up</strong>No ${filter === "all" ? "new activity" : escapeHtml(filter)} to show right now.</div>`;
  const unread = items.filter((item) => !item.read).length;
  const rows = items.map((item) => {
    const actor = item.actor;
    const avatar = safeUrl(actor?.avatar_url);
    const isReward = item.type === "reward";
    const actorMarkup = actor
      ? `<img class="notification-avatar" src="${escapeHtml(avatar || logoUrl)}" alt="${escapeHtml(actor.display_name || "PayMoment user")}" onerror="this.onerror=null;this.src='${escapeHtml(logoUrl)}'" />`
      : `<span class="notification-glyph${isReward ? " reward" : ""}">${notificationIcon(item.type)}</span>`;
    const verified = actor?.verified ? verifiedMarkup : "";
    const actorName = actor?.display_name ? `<strong>${escapeHtml(actor.display_name)}</strong>${verified} ` : "";
    const handle = actor?.username ? `@${escapeHtml(actor.username)} · ` : "";
    const reward = isReward && item.reward_amount ? `<span class="notification-reward">${item.reward_action === "redeemed" ? "-" : "+"}${escapeHtml(item.reward_amount.toLocaleString())} BOX</span>` : "";
    return `<button type="button" class="notification-item${item.read ? "" : " unread"}" data-open="${escapeHtml(safeUrl(item.href) || safeUrl(website))}" aria-label="Open notification: ${escapeHtml(`${actor?.display_name ? `${actor.display_name} ` : ""}${item.text || "PayMoment update"}`)}">${actorMarkup}<span class="notification-content"><span class="notification-copy">${actorName}${escapeHtml(item.text || "sent you a PayMoment update.")}</span>${reward}<span class="notification-meta">${handle}${escapeHtml(relativeTime(item.created_at))}</span></span><span class="notification-side${isReward ? " reward" : ""}">${notificationIcon(item.type)}${item.read ? "" : '<span class="unread-dot" title="Unread"></span>'}</span></button>`;
  }).join("");
  const notificationsUrl = safeUrl(website) ? `${safeUrl(website).replace(/\/$/, "")}/notifications` : "";
  const footer = hasMore && notificationsUrl ? `<footer class="notification-footer"><button class="button" data-open="${escapeHtml(notificationsUrl)}">View more notifications</button></footer>` : "";
  return `<section class="notification-panel"><div class="notification-summary"><span class="notification-count">${escapeHtml(items.length)} ${items.length === 1 ? "notification" : "notifications"}</span><span>${unread ? `${escapeHtml(unread)} unread` : "All read"}</span></div>${rows}${footer}</section>`;
}

function conversationMarkup(conversations: ConversationItem[] | undefined, website?: string) {
  const items = conversations ?? [];
  if (!items.length) return `<div class="empty"><span class="empty-icon">${notificationIcon("message")}</span><strong>No conversations yet</strong>Your PayMoment messages will appear here.</div>`;
  const unread = items.filter((item) => item.unread).length;
  const rows = items.map((item) => {
    const participant = item.participant;
    const avatar = safeUrl(participant?.avatar_url);
    const displayName = participant?.display_name || item.title || "PayMoment conversation";
    const verified = participant?.verified ? verifiedMarkup : "";
    const preview = item.last_message?.body || "No messages yet.";
    const prefix = item.last_message?.is_from_me ? '<span class="conversation-prefix">You: </span>' : "";
    const timestamp = item.last_message?.created_at || item.updated_at;
    const href = safeUrl(item.href) || (safeUrl(website) ? `${safeUrl(website).replace(/\/$/, "")}/messages` : "");
    return `<button type="button" class="notification-item${item.unread ? " unread" : ""}" data-open="${escapeHtml(href)}" aria-label="Open conversation with ${escapeHtml(displayName)}"><img class="notification-avatar" src="${escapeHtml(avatar || logoUrl)}" alt="${escapeHtml(displayName)}" onerror="this.onerror=null;this.src='${escapeHtml(logoUrl)}'" /><span class="notification-content"><span class="conversation-name">${escapeHtml(displayName)}${verified}</span><span class="conversation-preview">${prefix}${escapeHtml(preview)}</span><span class="notification-meta">${participant?.username ? `@${escapeHtml(participant.username)} · ` : ""}${escapeHtml(relativeTime(timestamp))}</span></span><span class="notification-side">${notificationIcon("message")}${item.unread ? '<span class="unread-dot" title="Unread"></span>' : ""}</span></button>`;
  }).join("");
  return `<section class="notification-panel"><div class="notification-summary"><span class="notification-count">${escapeHtml(items.length)} ${items.length === 1 ? "conversation" : "conversations"}</span><span>${unread ? `${escapeHtml(unread)} unread` : "All read"}</span></div>${rows}</section>`;
}

function searchMarkup(results: NonNullable<ToolResult["structuredContent"]>["results"], website?: string) {
  if (!results) return `<div class="empty">No results found.</div>`;
  const sections = [
    ...(results.people?.length ? [`<section class="card"><div class="card-head"><div class="handle">People</div></div><pre class="body">${escapeHtml(JSON.stringify(results.people, null, 2))}</pre></section>`] : []),
    ...(results.moments?.length ? results.moments.map((card) => cardMarkup(card, website)) : []),
    ...(results.articles?.length ? results.articles.map((card) => cardMarkup(card, website)) : []),
    ...(results.topics?.length ? [`<section class="card"><div class="card-head"><div class="handle">Hashtags</div></div><pre class="body">${escapeHtml(JSON.stringify(results.topics, null, 2))}</pre></section>`] : []),
  ];
  return sections.length ? sections.join("") : `<div class="empty">No results found.</div>`;
}

function render(result?: ToolResult) {
  const data = result?.structuredContent;
  if (!data) {
    const skeletonRows = [0, 1, 2].map(() => '<div class="skeleton-row"><span class="skeleton-avatar"></span><span class="skeleton-copy"><span class="skeleton-line"></span><span class="skeleton-line short"></span></span></div>').join("");
    root.innerHTML = `${styles()}<section class="shell"><header class="header"><img class="brand-logo" src="${escapeHtml(logoUrl)}" alt="PayMoment" /><span class="eyebrow">Loading</span></header><div class="cards" aria-label="Loading PayMoment card"><section class="notification-panel skeleton-panel">${skeletonRows}</section></div></section>`;
    return;
  }
  const profile = data?.profile ?? (data?.type === "paymoment.profile" ? data.card as Profile | undefined : undefined);
  const cards = data?.cards ?? (data?.card ? [data.card] : []);
  const isNotifications = data?.type === "paymoment.notifications";
  const isConversations = data?.type === "paymoment.conversations";
  const isSearch = data?.type === "paymoment.search";
  const postCards = cards.map((card) => cardMarkup(card, data?.brand?.website)).join("");
  const content = profile ? profileMarkup(profile, data?.brand?.website) : data?.reward ? rewardMarkup(data.reward) : isNotifications ? notificationMarkup(data.notifications, data?.brand?.website, data.filter, data.pagination?.has_more) : isConversations ? conversationMarkup(data.conversations, data?.brand?.website) : data?.action ? `${actionMarkup(data.action)}${postCards}` : isSearch ? searchMarkup(data.results, data?.brand?.website) : cards.length ? postCards : `<div class="empty">No Moments to show yet.</div>`;
  const heading = profile ? "Profile" : data?.reward ? "Box" : isNotifications ? "Notifications" : isConversations ? "Messages" : data?.action ? "Update" : isSearch ? "Search" : "Social";
  const notificationsUrl = isNotifications && safeUrl(data?.brand?.website) ? `${safeUrl(data?.brand?.website).replace(/\/$/, "")}/notifications` : "";
  const messagesUrl = isConversations && safeUrl(data?.brand?.website) ? `${safeUrl(data?.brand?.website).replace(/\/$/, "")}/messages` : "";
  const toolbar = notificationsUrl ? `<button class="button primary" data-open="${escapeHtml(notificationsUrl)}">Open notifications</button>` : messagesUrl ? `<button class="button primary" data-open="${escapeHtml(messagesUrl)}">Open messages</button>` : profile || data?.reward || data?.action || isSearch ? "" : `<button class="button primary" data-refresh>Refresh Moments</button>`;
  root.innerHTML = `${styles()}<section class="shell"><header class="header"><img class="brand-logo" src="${escapeHtml(logoUrl)}" alt="PayMoment" /><span class="eyebrow">${heading}</span></header><div class="toolbar">${toolbar}<span class="status" role="status"></span></div><div class="cards">${content}</div></section>`;
  root.querySelectorAll<HTMLElement>(".avatar, .profile-avatar").forEach((element) => {
    if (element.tagName === "IMG") {
      const image = element as HTMLImageElement;
      image.addEventListener("error", () => { image.onerror = null; image.src = logoUrl; }, { once: true });
      if (!image.src) image.src = logoUrl;
    } else {
      element.innerHTML = `<img src="${escapeHtml(logoUrl)}" alt="PayMoment" />`;
    }
  });
  root.querySelectorAll<HTMLImageElement | HTMLVideoElement>(".media").forEach((media) => media.addEventListener("error", () => media.closest(".media-wrap")?.classList.add("failed"), { once: true }));
  root.querySelector<HTMLButtonElement>("[data-refresh]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "Refreshing…";
    try {
      const next = await app.callServerTool({ name: "paymoment_list_moments", arguments: { limit: 10 } });
      if ((next as { isError?: boolean }).isError) throw new Error("The PayMoment feed could not be loaded.");
      render(next as ToolResult);
    } catch (error) {
      const status = root.querySelector<HTMLElement>(".status");
      if (status) { status.textContent = error instanceof Error ? error.message : "The PayMoment feed could not be loaded."; status.className = "status error"; }
    } finally {
      button.disabled = false;
      button.textContent = "Refresh Moments";
    }
  });
  root.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((button) => button.addEventListener("click", () => { void app.openLink({ url: button.dataset.open! }); }));
  root.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => button.addEventListener("click", async () => { const value = button.dataset.copy; if (!value) return; await navigator.clipboard?.writeText(value); button.textContent = "Copied"; setTimeout(() => { button.textContent = "Copy link"; }, 1200); }));
}

app.ontoolresult = (result) => render(result as ToolResult);
render();
void app.connect();
