import { App } from "@modelcontextprotocol/ext-apps";
import logoUrl from "./paymoment.png";
import boxLogoUrl from "./payboxlogo.png";

type Card = {
  id?: string;
  body?: string;
  author?: { display_name?: string; username?: string; avatar_url?: string; verified?: boolean; entitlement?: { verified?: boolean } };
  media?: Array<{ url?: string; alt_text?: string }>;
  counts?: { likes?: number; replies?: number; reposts?: number };
};

type ToolResult = {
  structuredContent?: { type?: string; card?: Card; cards?: Card[]; profile?: Profile; reward?: { title?: string; balance?: number; claimed?: boolean; redeemed?: boolean; unit?: string; granted_points?: number }; brand?: { name?: string; website?: string }; pagination?: { has_more?: boolean } };
};

type Profile = {
  id?: string;
  display_name?: string;
  username?: string | null;
  avatar_url?: string | null;
  bio?: string;
  location?: string | null;
  website_url?: string | null;
  interests?: Array<{ label?: string; slug?: string }>;
  followers_count?: number;
  following_count?: number;
  joined_at?: string;
  entitlement?: { verified?: boolean; points_balance?: number };
};

const app = new App({ name: "PayMoment Social", version: "1.0.0" });
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

const verifiedIconUrl = "https://api.iconify.design/si/verified-fill.svg?color=%23B8A2FF";

function styles() {
  return `<style>
  :root{color-scheme:dark;font:13px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#08090a;color:#f5f5f7}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 90% 0,#8056e825,transparent 38%),#08090a}.shell{max-width:560px;margin:auto;padding:12px}.header{display:flex;align-items:center;gap:9px;margin-bottom:10px}.brand-logo{display:block;width:118px;height:28px;object-fit:contain;object-position:left center}.eyebrow{margin-left:auto;color:#a6a6ad;font-size:10px;letter-spacing:.08em;text-transform:uppercase}.toolbar{display:flex;gap:8px;margin-bottom:9px}.button{min-height:36px;border:1px solid #292a2f;border-radius:12px;background:#17181b;color:#f5f5f7;padding:0 11px;font:inherit;font-weight:650;cursor:pointer}.button:hover{border-color:#8056e8}.button:focus-visible{outline:2px solid #b8a2ff;outline-offset:2px}.button.primary{border-color:transparent;background:linear-gradient(100deg,#b8a2ff,#8056e8);color:#100c17}.button:disabled{cursor:wait;opacity:.7}.cards{display:grid;gap:9px}.card,.profile-card,.reward-card{overflow:hidden;border:1px solid #292a2f;border-radius:18px;background:#101113}.card-head{display:flex;align-items:center;gap:9px;padding:11px 13px 7px}.avatar{width:30px;height:30px;border-radius:50%;object-fit:cover;background:#292a2f}.author{min-width:0}.name{font-weight:720;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.handle{color:#a6a6ad;font-size:11px}.body{padding:0 13px 10px;white-space:pre-wrap;word-break:break-word}.media{display:block;width:100%;max-height:290px;object-fit:cover;background:#17181b}.stats{display:flex;align-items:center;gap:11px;padding:9px 13px;color:#a6a6ad;font-size:11px;border-top:1px solid #292a2f}.card-actions{display:flex;gap:6px;margin-left:auto}.small{min-height:31px;padding:0 9px;border-radius:10px;font-size:11px}.empty{padding:22px 13px;text-align:center;color:#a6a6ad;border:1px dashed #292a2f;border-radius:18px}.status{min-height:18px;color:#a6a6ad;font-size:11px}.reward-card{display:flex;align-items:center;gap:12px;padding:16px}.reward-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,#b8a2ff,#8056e8);color:#15101f;font-size:20px;font-weight:800}.reward-label{color:#a6a6ad;font-size:11px;text-transform:uppercase;letter-spacing:.08em}.reward-amount{font-size:25px;font-weight:800;letter-spacing:-.04em}.reward-amount span{font-size:12px;color:#b8a2ff}.reward-title{color:#a6a6ad;font-size:12px}.profile-cover{height:68px;background:linear-gradient(120deg,#2b214a,#8056e8 55%,#b8a2ff)}.profile-content{padding:0 15px 15px}.profile-top{display:flex;align-items:flex-end;justify-content:space-between;margin-top:-24px}.profile-avatar{width:62px;height:62px;border:4px solid #101113;border-radius:50%;object-fit:cover;background:#292a2f}.profile-actions{display:flex;gap:6px;padding-bottom:3px}.profile-name{margin-top:10px;font-size:18px}.verified{display:inline-grid;place-items:center;width:17px;height:17px;margin-left:5px;border-radius:50%;background:#b8a2ff;color:#17121f;font-size:11px;vertical-align:2px}.profile-bio{margin:10px 0;color:#d6d2dc;white-space:pre-wrap}.profile-stats{display:flex;gap:13px;padding:10px 0;border-top:1px solid #292a2f;border-bottom:1px solid #292a2f;color:#a6a6ad;font-size:11px}.profile-stats strong{color:#f5f5f7;font-size:13px}.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.tag{padding:4px 8px;border-radius:999px;background:#8056e81f;color:#c5b7ff;font-size:11px}.profile-meta{display:flex;gap:12px;margin-top:11px;color:#a6a6ad;font-size:11px}.profile-meta a{color:#b8a2ff}.error{color:#ff8a98}@media(max-width:480px){.shell{padding:10px}.card-actions{gap:4px}.small{padding:0 7px}.profile-stats{gap:9px}}
.verified{width:16px;height:16px;margin-left:5px;vertical-align:-3px}.verified img{display:block;width:100%;height:100%}.avatar,.profile-avatar{overflow:hidden;display:block}.avatar img,.profile-avatar img{width:100%;height:100%;object-fit:contain;padding:5px}.reward-icon{width:42px;height:42px;object-fit:contain;padding:7px;border-radius:14px;background:#17181b}.reward-earned{display:block;color:#53d39a;font-size:12px;font-weight:700;margin-top:2px}
  </style>`;
}

function cardMarkup(card: Card, website?: string) {
  const author = card.author ?? {};
  const media = card.media?.find((item) => safeUrl(item.url));
  const avatar = safeUrl(author.avatar_url);
  const postUrl = card.id && safeUrl(website) ? `${safeUrl(website).replace(/\/$/, "")}/post/${encodeURIComponent(card.id)}` : "";
  const avatarMarkup = `<img class="avatar" src="${escapeHtml(avatar || boxLogoUrl)}" alt="PayBox avatar" onerror="this.onerror=null;this.src='${escapeHtml(boxLogoUrl)}'" />`;
  const verifiedMarkup = (author.verified || author.entitlement?.verified) ? `<span class="verified" title="Verified PayMoment account" aria-label="Verified"><img src="${verifiedIconUrl}" alt="" /></span>` : "";
  return `<article class="card"><div class="card-head">${avatarMarkup}<div class="author"><div class="name">${escapeHtml(author.display_name || "PayMoment user")}${verifiedMarkup}</div><div class="handle">@${escapeHtml(author.username || "paymoment.user")}</div></div></div><div class="body">${escapeHtml(card.body || "")}</div>${media ? `<img class="media" src="${escapeHtml(safeUrl(media.url))}" alt="${escapeHtml(media.alt_text || "PayMoment attachment")}" />` : ""}<div class="stats"><span>Likes ${card.counts?.likes ?? 0}</span><span>Replies ${card.counts?.replies ?? 0}</span><span>Reposts ${card.counts?.reposts ?? 0}</span><div class="card-actions">${postUrl ? `<button class="button small" data-open="${escapeHtml(postUrl)}">Open</button><button class="button small" data-copy="${escapeHtml(postUrl)}">Copy link</button>` : ""}</div></div></article>`;
}

function profileMarkup(profile: Profile, website?: string) {
  const avatar = safeUrl(profile.avatar_url);
  const profileUrl = profile.username && safeUrl(website) ? `${safeUrl(website).replace(/\/$/, "")}/u/${encodeURIComponent(profile.username)}` : "";
  const interests = profile.interests?.map((interest) => `<span class="tag">#${escapeHtml(interest.label || interest.slug)}</span>`).join("") || "";
  const profileAvatar = boxLogoUrl;
  const verifiedMarkup = profile.entitlement?.verified ? `<span class="verified" title="Verified PayMoment account" aria-label="Verified"><img src="${verifiedIconUrl}" alt="" /></span>` : "";
  return `<article class="profile-card"><div class="profile-cover"></div><div class="profile-content"><div class="profile-top"><img class="profile-avatar" src="${escapeHtml(profileAvatar)}" alt="PayBox avatar" onerror="this.onerror=null;this.src='${escapeHtml(boxLogoUrl)}'" /><div class="profile-actions">${profileUrl ? `<button class="button small" data-open="${escapeHtml(profileUrl)}">Open profile</button><button class="button small" data-copy="${escapeHtml(profileUrl)}">Copy link</button>` : ""}</div></div><div class="name profile-name">${escapeHtml(profile.display_name || "PayMoment user")}${verifiedMarkup}</div><div class="handle">@${escapeHtml(profile.username || "paymoment.user")}</div>${profile.bio ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>` : ""}<div class="profile-stats"><span><strong>${profile.followers_count ?? 0}</strong> followers</span><span><strong>${profile.following_count ?? 0}</strong> following</span><span><strong>${profile.entitlement?.points_balance ?? 0}</strong> points</span></div>${interests ? `<div class="tags">${interests}</div>` : ""}${profile.location || profile.website_url ? `<div class="profile-meta">${profile.location ? `<span>Location: ${escapeHtml(profile.location)}</span>` : ""}${safeUrl(profile.website_url) ? `<a href="${escapeHtml(safeUrl(profile.website_url))}" target="_blank" rel="noreferrer">Website</a>` : ""}</div>` : ""}</div></article>`;
}

function rewardMarkup(reward: NonNullable<ToolResult["structuredContent"]>["reward"]) {
  if (!reward) return "";
  const label = reward.claimed === false ? "Already claimed" : reward.claimed ? "Box earned" : "Box balance";
  const earned = reward.claimed && reward.granted_points ? `<span class="reward-earned">+${escapeHtml(reward.granted_points)} Box earned</span>` : "";
  return `<article class="reward-card"><img class="reward-icon" src="${escapeHtml(boxLogoUrl)}" alt="PayBox" /><div><div class="reward-label">${escapeHtml(label)}</div><div class="reward-amount">${escapeHtml(reward.balance ?? 0)} <span>${escapeHtml(reward.unit || "Box")}</span></div>${earned}<div class="reward-title">${escapeHtml(reward.title || "PayMoment Box")}</div></div></article>`;
}

function render(result?: ToolResult) {
  const data = result?.structuredContent;
  const profile = data?.profile ?? (data?.type === "paymoment.profile" ? data.card as Profile | undefined : undefined);
  const cards = data?.cards ?? (data?.card ? [data.card] : []);
  const content = profile ? profileMarkup(profile, data?.brand?.website) : data?.reward ? rewardMarkup(data.reward) : cards.length ? cards.map((card) => cardMarkup(card, data?.brand?.website)).join("") : `<div class="empty">No Moments to show yet.</div>`;
  const heading = profile ? "Profile" : data?.reward ? "Box" : "Social";
  root.innerHTML = `${styles()}<section class="shell"><header class="header"><img class="brand-logo" src="${escapeHtml(logoUrl)}" alt="PayMoment" /><span class="eyebrow">${heading}</span></header><div class="toolbar">${profile || data?.reward ? "" : `<button class="button primary" data-refresh>Refresh Moments</button>`}<span class="status" role="status"></span></div><div class="cards">${content}</div></section>`;
  root.querySelectorAll<HTMLElement>(".avatar, .profile-avatar").forEach((element) => {
    if (element.tagName === "IMG") {
      const image = element as HTMLImageElement;
      image.addEventListener("error", () => { image.onerror = null; image.src = logoUrl; }, { once: true });
      if (!image.src) image.src = logoUrl;
    } else {
      element.innerHTML = `<img src="${escapeHtml(logoUrl)}" alt="PayMoment" />`;
    }
  });
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
