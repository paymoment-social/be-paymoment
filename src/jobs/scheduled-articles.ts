import { publishScheduledArticles } from "../modules/posts/posts.service";

let timer: ReturnType<typeof setInterval> | undefined;

export async function processScheduledArticles() {
  const published = await publishScheduledArticles();
  if (published) console.info(JSON.stringify({ level: "info", message: "Scheduled articles published.", count: published }));
  return published;
}

export function startScheduledArticleWorker() {
  if (!timer) timer = setInterval(() => { void processScheduledArticles().catch((error) => console.error(JSON.stringify({ level: "error", message: "Scheduled article worker failed.", error: error instanceof Error ? error.message : String(error) }))); }, 10_000);
}

export function stopScheduledArticleWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
