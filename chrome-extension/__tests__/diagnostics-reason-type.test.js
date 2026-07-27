import { describe, it, expect } from "vitest";
import { diagnosticsReasonType } from "../lib/diagnostics-reason-type.js";

describe("diagnosticsReasonType", () => {
  it("returns 'mismatch' when versionMismatchReason set", () => {
    expect(
      diagnosticsReasonType({
        versionMismatchReason: "app protocol=999 not in [1,2] (ext=2)",
        csp: { inspected: false, ok: null },
        appReachable: "offline",
        ready: false,
      }),
    ).toBe("mismatch");
  });

  it("returns 'csp' when csp.ok is false and no mismatch", () => {
    expect(
      diagnosticsReasonType({
        versionMismatchReason: null,
        csp: { inspected: true, ok: false },
        appReachable: "online-unverified",
        ready: false,
      }),
    ).toBe("csp");
  });

  it("returns 'network' when the browser is offline", () => {
    expect(
      diagnosticsReasonType({
        versionMismatchReason: null,
        csp: { inspected: false, ok: null },
        appReachable: "offline",
        ready: false,
      }),
    ).toBe("network");
  });

  it("returns 'timeout' when not ready and csp/mismatch clean", () => {
    expect(
      diagnosticsReasonType({
        versionMismatchReason: null,
        csp: { inspected: false, ok: null },
        appReachable: "online-unverified",
        ready: false,
      }),
    ).toBe("timeout");
  });

  it("returns 'ok' when everything is fine", () => {
    expect(
      diagnosticsReasonType({
        versionMismatchReason: null,
        csp: { inspected: false, ok: null },
        appReachable: "online-unverified",
        ready: true,
      }),
    ).toBe("ok");
  });

  it("tolerates missing csp", () => {
    expect(
      diagnosticsReasonType({
        versionMismatchReason: null,
        csp: null,
        appReachable: "online-unverified",
        ready: false,
      }),
    ).toBe("timeout");
  });
});
