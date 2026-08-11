import { describe, expect, test } from "bun:test";
import { paginateFeedCandidates } from "./feed-pagination";

describe("feed candidate pagination", () => {
  test("keeps every ranked candidate available across For You pages", () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: `post-${index + 1}`,
      authorId: index < 18 ? "author-a" : `author-${index}`,
    }));

    const firstPage = paginateFeedCandidates(rows, 20, true);
    expect(firstPage.hasMore).toBeTrue();
    expect(firstPage.page).toHaveLength(20);
    expect(firstPage.cursorRow?.id).toBe("post-20");
    expect(new Set(firstPage.page.map((post) => post.id))).toEqual(new Set(rows.slice(0, 20).map((post) => post.id)));

    const secondPage = paginateFeedCandidates(rows.slice(20), 20, true);
    expect(secondPage.hasMore).toBeFalse();
    expect(secondPage.page.map((post) => post.id)).toEqual(["post-21"]);
  });

  test("reorders only within the current page for author diversity", () => {
    const rows = [
      { id: "a-1", authorId: "a" },
      { id: "a-2", authorId: "a" },
      { id: "a-3", authorId: "a" },
      { id: "b-1", authorId: "b" },
      { id: "c-1", authorId: "c" },
    ];

    const result = paginateFeedCandidates(rows, 5, true);
    expect(result.page.map((post) => post.id)).toEqual(["a-1", "a-2", "b-1", "c-1", "a-3"]);
    expect(result.cursorRow?.id).toBe("c-1");
  });
});
