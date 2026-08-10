import { Hono } from "hono";
import { success } from "../../lib/responses";
import { parseQuery } from "../../lib/validation";
import { requireSession } from "../auth/auth.service";
import { discoverQuerySchema, discoverSuggestionsQuerySchema } from "./discover.schemas";
import { discover, discoverSuggestions, trendingTopics } from "./discover.service";

export const discoverRoutes = new Hono();

discoverRoutes.get("/suggestions", async (c) => {
  await requireSession(c);
  const query = parseQuery(c, discoverSuggestionsQuerySchema);
  return success(c, { suggestions: await discoverSuggestions(query.q, query.limit) });
});

discoverRoutes.get("/", async (c) => {
  const session = await requireSession(c);
  return success(c, await discover(session.user.id, parseQuery(c, discoverQuerySchema)));
});

discoverRoutes.get("/topics/trending", async (c) => {
  await requireSession(c);
  const { limit } = parseQuery(c, discoverQuerySchema.pick({ limit: true }));
  return success(c, { topics: await trendingTopics(limit) });
});
