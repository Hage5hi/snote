import { describe, it, expect } from "vitest";
import { resolveFallbackReason } from "../lib/fallback-reason.js";

describe("resolveFallbackReason", () => {
  const base = {
    versionMismatchReason: null,
    csp: { inspected: false, ok: null, reason: "not-inspected" },
    ready: true,
    iframeLoaded: true,
    retryCount: 0,
    appReachable: "online-unverified",
  };

  it("returns null when everything is fine", () => {
    expect(resolveFallbackReason(base)).toBeNull();
  });

  it("prioritises version mismatch", () => {
    expect(
      resolveFallbackReason({
        ...base,
        versionMismatchReason: "app protocol=999 not in [1,2] (ext=2)",
        csp: { ok: false, reason: "no CSP header" },
        ready: false,
      }),
    ).toBe("Handshake protocol mismatch: app protocol=999 not in [1,2] (ext=2)");
  });

  it("surfaces a CSP block only when the probe was actually inspected", () => {
    expect(
      resolveFallbackReason({
        ...base,
        ready: false,
        csp: { inspected: true, ok: false, reason: "missing frame-ancestors" },
      }),
    ).toBe("App CSP blocks embedding: missing frame-ancestors");
  });

  it("never labels an uninspected CSP as the failure", () => {
    expect(
      resolveFallbackReason({
        ...base,
        ready: false,
        csp: { inspected: false, ok: null, reason: "not-inspected" },
      }),
    ).not.toContain("CSP");
  });

  it("reports an offline network before the generic timeout", () => {
    expect(
      resolveFallbackReason({
        ...base,
        ready: false,
        iframeLoaded: false,
        appReachable: "offline",
      }),
    ).toBe("Network is offline. Reconnect, then retry.");
  });

  it("falls back to no-ready timeout", () => {
    expect(
      resolveFallbackReason({ ...base, ready: false, retryCount: 1 }),
    ).toBe(
      "App loaded but never sent syrin:ready after 1 retry(ies). Network = online-unverified.",
    );
  });

  it("tolerates missing csp/appReachable", () => {
    expect(
      resolveFallbackReason({
        versionMismatchReason: null,
        csp: null,
        ready: false,
        iframeLoaded: false,
        retryCount: 0,
        appReachable: null,
      }),
    ).toBe(
      "App did not load or send syrin:ready after 0 retry(ies). Network = unknown.",
    );
  });
});
