import { describe, expect, test } from "bun:test";
import { articlePlainText, extractTokens, sanitizeArticleHtml } from "./content";

describe("post and article content", () => {
  test("sanitizes executable HTML and unsafe URLs", () => {
    const html = sanitizeArticleHtml('<p onclick="alert(1)">Safe</p><script>alert(1)</script><a href="javascript:alert(1)">link</a>');
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
    expect(articlePlainText(html)).toBe("Safe link");
  });

  test("extracts normalized unique mentions and hashtags", () => {
    expect(extractTokens("Hi @Bayu.Dev and @bayu.dev #Build #build")).toEqual({ mentions: ["bayu.dev"], hashtags: ["build"] });
  });
});
