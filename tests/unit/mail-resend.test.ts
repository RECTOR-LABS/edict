import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

/**
 * The resend wrapper captures env vars at module import time (top-level const).
 * Each test that requires different env state must call vi.resetModules() and
 * re-import the module after stubbing the desired env so those stubs take effect.
 */
describe("sendMail", () => {
  // Trivial template — no real react-email component needed for these unit tests.
  const template = React.createElement("div", null, "hi");

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns { id: 'dev-skip' } when RESEND_API_KEY is not set", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("DEV_PRINT_MAGIC_LINKS", "false");

    const { sendMail } = await import("@/lib/mail/resend");
    const result = await sendMail({
      to: "test@example.com",
      subject: "Test subject",
      template,
    });

    expect(result).toEqual({ id: "dev-skip" });
  });

  it("does not throw when RESEND_API_KEY is not set", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("DEV_PRINT_MAGIC_LINKS", "false");

    const { sendMail } = await import("@/lib/mail/resend");

    await expect(
      sendMail({
        to: "test@example.com",
        subject: "Test subject",
        template,
      }),
    ).resolves.not.toThrow();
  });

  it("returns { id: 'dev-skip' } when DEV_PRINT_MAGIC_LINKS=true, even with a key set", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_fake_key_for_test");
    vi.stubEnv("DEV_PRINT_MAGIC_LINKS", "true");

    const { sendMail } = await import("@/lib/mail/resend");
    const result = await sendMail({
      to: "test@example.com",
      subject: "Test dev-print",
      template,
    });

    expect(result).toEqual({ id: "dev-skip" });
  });

  it("does not throw when DEV_PRINT_MAGIC_LINKS=true with a fake key", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_fake_key_for_test");
    vi.stubEnv("DEV_PRINT_MAGIC_LINKS", "true");

    const { sendMail } = await import("@/lib/mail/resend");

    await expect(
      sendMail({
        to: "test@example.com",
        subject: "Test dev-print",
        template,
      }),
    ).resolves.not.toThrow();
  });
});
