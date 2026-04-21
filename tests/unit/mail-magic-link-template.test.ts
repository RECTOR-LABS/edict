import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@react-email/render";
import { MagicLinkEmail } from "@/lib/mail/templates/magic-link";

const BASE_PROPS = {
  docTitle: "Adrena Arena Plan",
  magicLinkUrl: "https://edict.rectorspace.com/auth/verify?token=abc123",
  actorName: "RECTOR",
};

describe("MagicLinkEmail template", () => {
  it("contains the actor name", async () => {
    const html = await render(React.createElement(MagicLinkEmail, BASE_PROPS));
    expect(html).toContain("RECTOR");
  });

  it("contains the document title", async () => {
    const html = await render(React.createElement(MagicLinkEmail, BASE_PROPS));
    expect(html).toContain("Adrena Arena Plan");
  });

  it("contains the magic-link URL as an href", async () => {
    const html = await render(React.createElement(MagicLinkEmail, BASE_PROPS));
    expect(html).toContain(
      'href="https://edict.rectorspace.com/auth/verify?token=abc123"',
    );
  });

  it("contains the CTA label", async () => {
    const html = await render(React.createElement(MagicLinkEmail, BASE_PROPS));
    expect(html).toContain("Open your edict");
  });

  it("contains the disclaimer copy", async () => {
    const html = await render(React.createElement(MagicLinkEmail, BASE_PROPS));
    expect(html).toContain("valid for 24 hours");
  });

  it("includes recipientName in output when provided", async () => {
    const html = await render(
      React.createElement(MagicLinkEmail, {
        ...BASE_PROPS,
        recipientName: "Ada",
      }),
    );
    expect(html).toContain("Ada,");
  });

  it("does not produce a leading ', ' artifact when recipientName is null", async () => {
    const html = await render(
      React.createElement(MagicLinkEmail, {
        ...BASE_PROPS,
        recipientName: null,
      }),
    );
    // The body copy should start with the actor name, not a bare comma
    expect(html).not.toMatch(/, \s*RECTOR/);
  });

  it("contains an href matching the magicLinkUrl exactly", async () => {
    const url = "https://edict.rectorspace.com/auth/verify?token=abc123";
    const html = await render(React.createElement(MagicLinkEmail, BASE_PROPS));
    // Tolerate react-email wrapping the href in quotes; match exact value
    const hrefRegex = new RegExp(`href=["']${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
    expect(html).toMatch(hrefRegex);
  });
});
