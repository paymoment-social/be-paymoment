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
  structuredContent?: { type?: string; card?: Card; cards?: Card[]; profile?: Profile; reward?: { title?: string; balance?: number; claimed?: boolean; redeemed?: boolean; unit?: string; granted_points?: number }; action?: { title?: string; data?: unknown }; results?: { people?: unknown[]; moments?: Card[]; articles?: Card[]; topics?: unknown[] }; brand?: { name?: string; website?: string }; pagination?: { has_more?: boolean } };
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

const verifiedMarkup = `<img class="verified" src="${verifiedIconUrl}" title="Verified PayMoment account" aria-label="Verified account" alt="Verified" />`;

function styles() {
  return `<style>
  :root{color-scheme:dark;font:13px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#08090a;color:#f5f5f7}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 90% 0,#8056e825,transparent 38%),#08090a}.shell{max-width:560px;margin:auto;padding:12px}.header{display:flex;align-items:center;gap:9px;margin-bottom:10px}.brand-logo{display:block;width:118px;height:28px;object-fit:contain;object-position:left center}.eyebrow{margin-left:auto;color:#a6a6ad;font-size:10px;letter-spacing:.08em;text-transform:uppercase}.toolbar{display:flex;gap:8px;margin-bottom:9px}.button{min-height:40px;border:1px solid #292a2f;border-radius:12px;background:#17181b;color:#f5f5f7;padding:0 12px;font:inherit;font-weight:650;cursor:pointer}.button:hover{border-color:#8056e8}.button:focus-visible{outline:2px solid #b8a2ff;outline-offset:2px}.button.primary{border-color:transparent;background:linear-gradient(100deg,#b8a2ff,#8056e8);color:#100c17}.button:disabled{cursor:wait;opacity:.7}.cards{display:grid;gap:9px}.card,.profile-card,.reward-card{overflow:hidden;border:1px solid #292a2f;border-radius:16px;background:#101113}.card-head{display:flex;align-items:center;gap:9px;padding:12px 13px 8px}.avatar{display:block;width:34px;height:34px;border-radius:50%;object-fit:cover;background:#292a2f}.author{min-width:0}.name{display:flex;align-items:center;min-width:0;font-weight:720;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.handle{color:#a6a6ad;font-size:11px}.body{padding:0 13px 11px;white-space:pre-wrap;word-break:break-word}.media-wrap{position:relative;min-height:72px;background:#17181b}.media{display:block;width:100%;max-height:290px;object-fit:cover;background:#17181b}.media-fallback{display:none;min-height:72px;place-items:center;padding:16px;color:#a6a6ad;text-align:center}.media-wrap.failed .media{display:none}.media-wrap.failed .media-fallback{display:grid}.stats{display:flex;align-items:center;gap:11px;padding:9px 13px;color:#a6a6ad;font-size:11px;border-top:1px solid #292a2f}.card-actions{display:flex;gap:8px;margin-left:auto}.small{min-height:40px;padding:0 11px;border-radius:10px;font-size:11px}.empty{padding:22px 13px;text-align:center;color:#a6a6ad;border:1px dashed #292a2f;border-radius:16px}.status{min-height:18px;color:#a6a6ad;font-size:11px}.reward-card{display:flex;align-items:center;gap:12px;padding:16px}.reward-icon{width:42px;height:42px;object-fit:contain;padding:7px;border-radius:14px;background:#17181b}.reward-label{color:#a6a6ad;font-size:11px;text-transform:uppercase;letter-spacing:.08em}.reward-amount{font-size:25px;font-weight:800;letter-spacing:-.04em}.reward-amount span{font-size:12px;color:#b8a2ff}.reward-title{color:#a6a6ad;font-size:12px}.profile-cover{height:76px;background:linear-gradient(120deg,#2b214a,#8056e8 55%,#b8a2ff);background-size:cover}.profile-content{padding:0 15px 15px}.profile-top{display:flex;align-items:flex-end;justify-content:space-between;margin-top:-26px}.profile-avatar{display:block;width:62px;height:62px;border:4px solid #101113;border-radius:50%;object-fit:cover;background:#292a2f}.profile-actions{display:flex;gap:8px;padding-bottom:3px}.profile-name{margin-top:10px;font-size:18px}.verified{display:inline-block;flex:0 0 auto;width:16px;height:16px;margin-left:5px;border:0;border-radius:0;background:transparent;object-fit:contain}.profile-bio{margin:10px 0;color:#d6d2dc;white-space:pre-wrap}.profile-stats{display:flex;gap:13px;padding:10px 0;border-top:1px solid #292a2f;border-bottom:1px solid #292a2f;color:#a6a6ad;font-size:11px}.profile-stats strong{color:#f5f5f7;font-size:13px}.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.tag{padding:4px 8px;border-radius:999px;background:#8056e81f;color:#c5b7ff;font-size:11px}.profile-meta{display:flex;gap:12px;margin-top:11px;color:#a6a6ad;font-size:11px}.profile-meta a{color:#b8a2ff}.error{color:#ff8a98}@media(max-width:480px){.shell{padding:10px}.stats{align-items:flex-start;flex-wrap:wrap}.card-actions{width:100%;margin-left:0}.small{flex:1}.profile-stats{gap:9px}}
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
  return `<article class="card"><div class="card-head"><img class="avatar" src="${escapeHtml(boxLogoUrl)}" alt="PayBox" /><div class="name">${escapeHtml(action?.title || "PayMoment update")}</div></div><pre class="body">${escapeHtml(JSON.stringify(action?.data ?? {}, null, 2))}</pre></article>`;
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
  const profile = data?.profile ?? (data?.type === "paymoment.profile" ? data.card as Profile | undefined : undefined);
  const cards = data?.cards ?? (data?.card ? [data.card] : []);
  const content = profile ? profileMarkup(profile, data?.brand?.website) : data?.reward ? rewardMarkup(data.reward) : data?.action ? actionMarkup(data.action) : data?.type === "paymoment.search" ? searchMarkup(data.results, data?.brand?.website) : cards.length ? cards.map((card) => cardMarkup(card, data?.brand?.website)).join("") : `<div class="empty">No Moments to show yet.</div>`;
  const heading = profile ? "Profile" : data?.reward ? "Box" : data?.action ? "Update" : data?.type === "paymoment.search" ? "Search" : "Social";
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
