export function paginateFeedCandidates<T extends { authorId: string }>(rows: T[], limit: number, diversify: boolean) {
  const rankedPage = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  if (!diversify) return { page: rankedPage, cursorRow: rankedPage.at(-1), hasMore };

  const selected: T[] = [];
  const deferred: T[] = [];
  const authorCounts = new Map<string, number>();
  for (const row of rankedPage) {
    const countForAuthor = authorCounts.get(row.authorId) ?? 0;
    if (countForAuthor >= 2) {
      deferred.push(row);
      continue;
    }
    selected.push(row);
    authorCounts.set(row.authorId, countForAuthor + 1);
  }

  return {
    page: [...selected, ...deferred],
    cursorRow: rankedPage.at(-1),
    hasMore,
  };
}
