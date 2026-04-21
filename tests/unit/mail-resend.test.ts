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
    vi.restoreAllMocks();
  });

  it("returns { id: 'dev-skip' } when RESEND_API_KEY is not set", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("DEV_PRINT_MAGIC_LINKS", "false");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { sendMail } = await import("@/lib/mail/resend");
    const result = await sendMail({
      to: "test@example.com",
      subject: "Test subject",
      template,
    });

    expect(result).toEqual({ id: "dev-skip" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("[mail:dev]", {
      to: "test@example.com",
      subject: "Test subject",
      html_length: expect.any(Number),
    });
    const [, payload1] = warnSpy.mock.calls.at(0) ?? [];
    expect((payload1 as { html_length: number }).html_length).toBeGreaterThan(0);
  });

  it("does not throw when RESEND_API_KEY is not set", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("DEV_PRINT_MAGIC_LINKS", "false");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { sendMail } = await import("@/lib/mail/resend");

    await expect(
      sendMail({
        to: "test@example.com",
        subject: "Test subject",
        template,
      }),
    ).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("[mail:dev]", {
      to: "test@example.com",
      subject: "Test subject",
      html_length: expect.any(Number),
    });
    const [, payload2] = warnSpy.mock.calls.at(0) ?? [];
    expect((payload2 as { html_length: number }).html_length).toBeGreaterThan(0);
  });

  it("returns { id: 'dev-skip' } when DEV_PRINT_MAGIC_LINKS=true, even with a key set", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_fake_key_for_test");
    vi.stubEnv("DEV_PRINT_MAGIC_LINKS", "true");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { sendMail } = await import("@/lib/mail/resend");
    const result = await sendMail({
      to: "test@example.com",
      subject: "Test dev-print",
      template,
    });

    expect(result).toEqual({ id: "dev-skip" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("[mail:dev]", {
      to: "test@example.com",
      subject: "Test dev-print",
      html_length: expect.any(Number),
    });
    const [, payload3] = warnSpy.mock.calls.at(0) ?? [];
    expect((payload3 as { html_length: number }).html_length).toBeGreaterThan(0);
  });

  it("does not throw when DEV_PRINT_MAGIC_LINKS=true with a fake key", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_fake_key_for_test");
    vi.stubEnv("DEV_PRINT_MAGIC_LINKS", "true");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { sendMail } = await import("@/lib/mail/resend");

    await expect(
      sendMail({
        to: "test@example.com",
        subject: "Test dev-print",
        template,
      }),
    ).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("[mail:dev]", {
      to: "test@example.com",
      subject: "Test dev-print",
      html_length: expect.any(Number),
    });
    const [, payload4] = warnSpy.mock.calls.at(0) ?? [];
    expect((payload4 as { html_length: number }).html_length).toBeGreaterThan(0);
  });
});
