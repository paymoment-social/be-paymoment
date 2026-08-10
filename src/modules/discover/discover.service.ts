import type { DiscoverQuery } from "./discover.schemas";
import { listDiscoverSuggestions, listTrendingTopics, searchDiscover } from "./discover.repository";

export async function discover(viewerId: string, query: DiscoverQuery) {
  const data = await searchDiscover(viewerId, query.q, query.type, query.limit, query.cursor);
  return {
    people: query.type === "moments" || query.type === "articles" || query.type === "topics" ? [] : data.people,
    moments: query.type === "people" || query.type === "articles" || query.type === "topics" ? [] : data.moments,
    articles: query.type === "people" || query.type === "moments" || query.type === "topics" ? [] : data.articles,
    topics: query.type === "people" || query.type === "moments" || query.type === "articles" ? [] : data.topics,
    page: { next_cursor: data.nextCursor, has_more: data.hasMore },
  };
}

export const discoverSuggestions = (query: string, limit: number) => listDiscoverSuggestions(query, limit);

export const trendingTopics = (limit: number) => listTrendingTopics(limit);
