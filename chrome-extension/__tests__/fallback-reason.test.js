import { describe, it, expect } from "vitest";
import { resolveFallbackReason } from "../lib/fallback-reason.js";

describe("resolveFallbackReason", () => {
  const base = {
    versionMismatchReason: null,
    csp: { ok: true, reason: null },
    ready: true,
    retryCount: 0,
    appReachable: "200 ok",
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

  it("surfaces CSP block reason", () => {
    expect(
      resolveFallbackReason({
        ...base,
        ready: false,
        csp: { ok: false, reason: "missing frame-ancestors" },
      }),
    ).toBe("App CSP blocks embedding: missing frame-ancestors");
  });

  it("falls back to no-ready timeout", () => {
    expect(
      resolveFallbackReason({ ...base, ready: false, retryCount: 1 }),
    ).toBe("App never sent syrin:ready after 1 retry(ies). App reachable = 200 ok.");
  });

  it("tolerates missing csp/appReachable", () => {
    expect(
      resolveFallbackReason({
        versionMismatchReason: null,
        csp: null,
        ready: false,
        retryCount: 0,
        appReachable: null,
      }),
    ).toBe("App never sent syrin:ready after 0 retry(ies). App reachable = unknown.");
  });
});
