import { describe, it, expect } from "vitest";
import { renderMarkdown } from "@/lib/docs/render-markdown";

describe("renderMarkdown", () => {
  it("converts gfm table + heading", async () => {
    const html = await renderMarkdown("# Hello\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<table>");
  });

  it("strips disallowed script tags", async () => {
    const html = await renderMarkdown("<script>alert('x')</script>hi");
    expect(html).not.toContain("<script>");
  });

  it("converts links to anchor tags", async () => {
    const html = await renderMarkdown("[text](http://example.com)");
    expect(html).toContain("<a");
    expect(html).toContain("href=\"http://example.com\"");
    expect(html).toContain("text");
  });

  it("strips javascript: URLs from links", async () => {
    const html = await renderMarkdown("[x](javascript:alert(1))");
    // rehype-sanitize strips javascript: hrefs — anchor may remain but href must not be javascript:
    expect(html).not.toContain("javascript:");
  });

  it("renders fenced code blocks", async () => {
    const html = await renderMarkdown("```js\nconsole.log('x')\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("console.log");
  });
});
