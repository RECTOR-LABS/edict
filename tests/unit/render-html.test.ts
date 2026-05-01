import { describe, it, expect } from "vitest";
import { injectIframeBase } from "@/lib/docs/render-html";

describe("injectIframeBase", () => {
  it("injects <base> immediately after <head> when present", () => {
    const html = "<html><head><title>x</title></head><body>y</body></html>";
    const out = injectIframeBase(html);
    expect(out).toBe(
      '<html><head><base href="about:srcdoc"><title>x</title></head><body>y</body></html>',
    );
  });

  it("injects <base> after <head> with attributes", () => {
    const html = '<html><head lang="en"><title>x</title></head><body>y</body></html>';
    const out = injectIframeBase(html);
    expect(out).toContain('<head lang="en"><base href="about:srcdoc"><title>x</title>');
  });

  it("prepends <base> when no <head> tag exists", () => {
    const html = "<p>plain fragment</p>";
    const out = injectIframeBase(html);
    expect(out).toBe('<base href="about:srcdoc"><p>plain fragment</p>');
  });

  it("matches <head> case-insensitively", () => {
    const html = "<HTML><HEAD><TITLE>x</TITLE></HEAD></HTML>";
    const out = injectIframeBase(html);
    expect(out).toContain('<HEAD><base href="about:srcdoc"><TITLE>');
  });

  it("places injected <base> before any author-supplied <base> so ours wins", () => {
    // Browsers honor the first <base> in document order. Ours must come first.
    const html = '<html><head><base href="https://evil.example/"></head></html>';
    const out = injectIframeBase(html);
    const ours = out.indexOf('<base href="about:srcdoc">');
    const theirs = out.indexOf('<base href="https://evil.example/">');
    expect(ours).toBeGreaterThan(-1);
    expect(theirs).toBeGreaterThan(-1);
    expect(ours).toBeLessThan(theirs);
  });
});
