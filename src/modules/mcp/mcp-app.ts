import { App } from "@modelcontextprotocol/ext-apps";

type Card = {
  id?: string;
  body?: string;
  author?: { display_name?: string; username?: string; avatar_url?: string };
  media?: Array<{ url?: string; alt_text?: string }>;
  counts?: { likes?: number; replies?: number; reposts?: number };
};

type ToolResult = {
  structuredContent?: { type?: string; card?: Card; cards?: Card[]; profile?: Profile; brand?: { name?: string; website?: string }; pagination?: { has_more?: boolean } };
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

function styles() {
  return `<style>
  :root{color-scheme:dark;font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#08090a;color:#f5f5f7}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 90% 0,#8056e825,transparent 38%),#08090a}.shell{max-width:720px;margin:auto;padding:18px}.header{display:flex;align-items:center;gap:10px;margin-bottom:16px}.mark{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#b8a2ff,#8056e8);color:#17121f;font-weight:850;font-size:18px}.brand{font-weight:760;letter-spacing:-.03em}.eyebrow{margin-left:auto;color:#a6a6ad;font-size:11px;letter-spacing:.08em;text-transform:uppercase}.toolbar{display:flex;gap:8px;margin-bottom:12px}.button{min-height:40px;border:1px solid #292a2f;border-radius:10px;background:#17181b;color:#f5f5f7;padding:0 13px;font:inherit;font-weight:650;cursor:pointer}.button:hover{border-color:#8056e8}.button:focus-visible{outline:2px solid #b8a2ff;outline-offset:2px}.button.primary{border-color:transparent;background:linear-gradient(100deg,#b8a2ff,#8056e8);color:#100c17}.cards{display:grid;gap:12px}.card,.profile-card{overflow:hidden;border:1px solid #292a2f;border-radius:16px;background:#101113}.card-head{display:flex;align-items:center;gap:10px;padding:14px 15px 9px}.avatar{width:34px;height:34px;border-radius:50%;object-fit:cover;background:#292a2f}.author{min-width:0}.name{font-weight:720;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.handle{color:#a6a6ad;font-size:12px}.body{padding:0 15px 12px;white-space:pre-wrap;word-break:break-word}.media{display:block;width:100%;max-height:330px;object-fit:cover;background:#17181b}.stats{display:flex;align-items:center;gap:14px;padding:11px 15px;color:#a6a6ad;font-size:12px;border-top:1px solid #292a2f}.card-actions{display:flex;gap:8px;margin-left:auto}.small{min-height:34px;padding:0 10px;font-size:12px}.empty{padding:28px 15px;text-align:center;color:#a6a6ad;border:1px dashed #292a2f;border-radius:16px}.status{min-height:20px;color:#a6a6ad;font-size:12px}.profile-cover{height:84px;background:linear-gradient(120deg,#2b214a,#8056e8 55%,#b8a2ff)}.profile-content{padding:0 18px 18px}.profile-top{display:flex;align-items:flex-end;justify-content:space-between;margin-top:-27px}.profile-avatar{width:72px;height:72px;border:4px solid #101113;border-radius:50%;object-fit:cover;background:#292a2f}.profile-actions{display:flex;gap:7px;padding-bottom:4px}.profile-name{margin-top:12px;font-size:21px}.verified{display:inline-grid;place-items:center;width:18px;height:18px;margin-left:6px;border-radius:50%;background:#b8a2ff;color:#17121f;font-size:12px;vertical-align:2px}.profile-bio{margin:12px 0;color:#d6d2dc;white-space:pre-wrap}.profile-stats{display:flex;gap:16px;padding:13px 0;border-top:1px solid #292a2f;border-bottom:1px solid #292a2f;color:#a6a6ad;font-size:12px}.profile-stats strong{color:#f5f5f7;font-size:14px}.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}.tag{padding:5px 9px;border-radius:999px;background:#8056e81f;color:#c5b7ff;font-size:12px}.profile-meta{display:flex;gap:14px;margin-top:14px;color:#a6a6ad;font-size:12px}.profile-meta a{color:#b8a2ff}.error{color:#ff8a98}@media(max-width:480px){.shell{padding:12px}.card-actions{gap:4px}.small{padding:0 8px}.profile-stats{gap:10px}}
  </style>`;
}

function cardMarkup(card: Card, website?: string) {
  const author = card.author ?? {};
  const media = card.media?.find((item) => safeUrl(item.url));
  const avatar = safeUrl(author.avatar_url);
  const postUrl = card.id && safeUrl(website) ? `${safeUrl(website).replace(/\/$/, "")}/post/${encodeURIComponent(card.id)}` : "";
  return `<article class="card"><div class="card-head">${avatar ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="" />` : `<span class="avatar" aria-hidden="true"></span>`}<div class="author"><div class="name">${escapeHtml(author.display_name || "PayMoment user")}</div><div class="handle">@${escapeHtml(author.username || "paymoment.user")}</div></div></div><div class="body">${escapeHtml(card.body || "")}</div>${media ? `<img class="media" src="${escapeHtml(safeUrl(media.url))}" alt="${escapeHtml(media.alt_text || "PayMoment attachment")}" />` : ""}<div class="stats"><span>Likes ${card.counts?.likes ?? 0}</span><span>Replies ${card.counts?.replies ?? 0}</span><span>Reposts ${card.counts?.reposts ?? 0}</span><div class="card-actions">${postUrl ? `<button class="button small" data-open="${escapeHtml(postUrl)}">Open</button><button class="button small" data-copy="${escapeHtml(postUrl)}">Copy link</button>` : ""}</div></div></article>`;
}

function profileMarkup(profile: Profile, website?: string) {
  const avatar = safeUrl(profile.avatar_url);
  const profileUrl = profile.username && safeUrl(website) ? `${safeUrl(website).replace(/\/$/, "")}/u/${encodeURIComponent(profile.username)}` : "";
  const interests = profile.interests?.map((interest) => `<span class="tag">#${escapeHtml(interest.label || interest.slug)}</span>`).join("") || "";
  return `<article class="profile-card"><div class="profile-cover"></div><div class="profile-content"><div class="profile-top">${avatar ? `<img class="profile-avatar" src="${escapeHtml(avatar)}" alt="" />` : `<span class="profile-avatar" aria-hidden="true"></span>`}<div class="profile-actions">${profileUrl ? `<button class="button small" data-open="${escapeHtml(profileUrl)}">Open profile</button><button class="button small" data-copy="${escapeHtml(profileUrl)}">Copy link</button>` : ""}</div></div><div class="name profile-name">${escapeHtml(profile.display_name || "PayMoment user")}${profile.entitlement?.verified ? `<span class="verified" title="Verified PayMoment account" aria-label="Verified">✓</span>` : ""}</div><div class="handle">@${escapeHtml(profile.username || "paymoment.user")}</div>${profile.bio ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>` : ""}<div class="profile-stats"><span><strong>${profile.followers_count ?? 0}</strong> followers</span><span><strong>${profile.following_count ?? 0}</strong> following</span><span><strong>${profile.entitlement?.points_balance ?? 0}</strong> points</span></div>${interests ? `<div class="tags">${interests}</div>` : ""}${profile.location || profile.website_url ? `<div class="profile-meta">${profile.location ? `<span>Location: ${escapeHtml(profile.location)}</span>` : ""}${safeUrl(profile.website_url) ? `<a href="${escapeHtml(safeUrl(profile.website_url))}" target="_blank" rel="noreferrer">Website</a>` : ""}</div>` : ""}</div></article>`;
}

function render(result?: ToolResult) {
  const data = result?.structuredContent;
  const cards = data?.cards ?? (data?.card ? [data.card] : []);
  const content = data?.profile ? profileMarkup(data.profile, data.brand?.website) : cards.length ? cards.map((card) => cardMarkup(card, data?.brand?.website)).join("") : `<div class="empty">No Moments to show yet.</div>`;
  root.innerHTML = `${styles()}<section class="shell"><header class="header"><span class="mark" aria-hidden="true">P</span><span class="brand">${escapeHtml(data?.brand?.name || "PayMoment")}</span><span class="eyebrow">${data?.profile ? "Profile" : "Social"}</span></header><div class="toolbar">${data?.profile ? "" : `<button class="button primary" data-refresh>Refresh Moments</button>`}<span class="status" role="status"></span></div><div class="cards">${content}</div></section>`;
  root.querySelector<HTMLButtonElement>("[data-refresh]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "Refreshing…";
    try {
      const next = await app.callServerTool({ name: "paymoment_list_moments", arguments: { limit: 10 } });
      render(next as ToolResult);
    } finally {
      button.disabled = false;
    }
  });
  root.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((button) => button.addEventListener("click", () => { void app.openLink({ url: button.dataset.open! }); }));
  root.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => button.addEventListener("click", async () => { const value = button.dataset.copy; if (!value) return; await navigator.clipboard?.writeText(value); button.textContent = "Copied"; setTimeout(() => { button.textContent = "Copy link"; }, 1200); }));
}

app.ontoolresult = (result) => render(result as ToolResult);
render();
void app.connect();
