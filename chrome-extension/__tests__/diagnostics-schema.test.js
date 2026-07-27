import { describe, it, expect } from "vitest";
import {
  validateDiagnostics,
  truncateTelemetryDetails,
  DIAGNOSTICS_KIND,
  DIAGNOSTICS_SCHEMA_VERSION,
  MAX_TELEMETRY_DETAIL_BYTES,
} from "../lib/diagnostics-schema.js";

const validBundle = () => ({
  kind: DIAGNOSTICS_KIND,
  schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
  at: "2026-07-09T12:00:00.000Z",
  extensionVersion: "1.3.6",
  handshake: {
    extensionProtocol: 2,
    appProtocol: 2,
    appBuildId: "abc",
    ready: true,
    versionMismatch: null,
  },
  load: {
    iframeSrc: "https://note.syrin.online/",
    iframeLoaded: true,
    retryCount: 0,
    appReachable: "online-unverified",
  },
  cspFrameAncestors: {
    inspected: false,
    ok: null,
    csp: null,
    reason: "not-inspected",
  },
  messageTimeline: [],
  telemetry: [],
  telemetryEnabled: true,
  debugLines: [],
});

describe("validateDiagnostics", () => {
  it("accepts a well-formed bundle", () => {
    const r = validateDiagnostics(validBundle());
    expect(r).toEqual({ ok: true, errors: [] });
  });

  it("requires an honest network classification", () => {
    for (const appReachable of ["offline", "online-unverified", "unknown"]) {
      const b = validBundle();
      b.load.appReachable = appReachable;
      expect(validateDiagnostics(b)).toEqual({ ok: true, errors: [] });
    }

    const b = validBundle();
    b.load.appReachable = "200 ok";
    expect(validateDiagnostics(b).ok).toBe(false);
  });

  it("requires CSP inspection state to agree with the result fields", () => {
    const inspected = validBundle();
    inspected.cspFrameAncestors = {
      inspected: true,
      ok: false,
      csp: null,
      reason: "no-header",
    };
    expect(validateDiagnostics(inspected)).toEqual({ ok: true, errors: [] });

    const dishonest = validBundle();
    dishonest.cspFrameAncestors = {
      inspected: false,
      ok: false,
      csp: "frame-ancestors 'self'",
      reason: "extension-excluded",
    };
    expect(validateDiagnostics(dishonest).ok).toBe(false);
  });

  it("rejects non-object payloads", () => {
    expect(validateDiagnostics(null).ok).toBe(false);
    expect(validateDiagnostics("nope").ok).toBe(false);
  });

  it("reports every missing required field", () => {
    const r = validateDiagnostics({});
    expect(r.ok).toBe(false);
    for (const key of [
      "kind",
      "schemaVersion",
      "at",
      "extensionVersion",
      "handshake",
      "load",
      "cspFrameAncestors",
      "messageTimeline",
      "telemetry",
      "telemetryEnabled",
      "debugLines",
    ]) {
      expect(r.errors).toContain(`missing field: ${key}`);
    }
  });

  it("rejects wrong kind / schemaVersion constants", () => {
    const b = validBundle();
    b.kind = "other";
    b.schemaVersion = 999;
    const r = validateDiagnostics(b);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith("field kind:"))).toBe(true);
    expect(r.errors.some((e) => e.startsWith("field schemaVersion:"))).toBe(true);
  });

  it("rejects non-ISO `at`", () => {
    const b = validBundle();
    b.at = "not-a-date";
    const r = validateDiagnostics(b);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("ISO-8601"))).toBe(true);
  });

  it("rejects wrong types", () => {
    const b = validBundle();
    b.messageTimeline = {};
    b.telemetryEnabled = "yes";
    const r = validateDiagnostics(b);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("field messageTimeline: wrong type");
    expect(r.errors).toContain("field telemetryEnabled: wrong type");
  });

  it("rejects malformed handshake / load subfields", () => {
    const b = validBundle();
    b.handshake = { extensionProtocol: "2", appProtocol: null, appBuildId: null, ready: true, versionMismatch: null };
    b.load = { iframeSrc: 1, iframeLoaded: true, retryCount: 0 };
    const r = validateDiagnostics(b);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("handshake.extensionProtocol"))).toBe(true);
    expect(r.errors.some((e) => e.includes("load.iframeSrc"))).toBe(true);
  });

  it("valid bundle contains no forbidden PII keys", () => {
    const b = validBundle();
    const json = JSON.stringify(b);
    const denyList = [/"slug"/i, /"noteBody"/i, /"authToken"/i, /"password"/i, /"userEmail"/i];
    for (const re of denyList) {
      expect(json).not.toMatch(re);
    }
  });

  it("rejects bundle with forbidden key at top level", () => {
    const b = { ...validBundle(), slug: "leaked" };
    const r = validateDiagnostics(b);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("forbidden key present: slug");
  });

  it("rejects bundle with forbidden key nested inside handshake", () => {
    const b = validBundle();
    b.handshake = { ...b.handshake, authToken: "secret" };
    const r = validateDiagnostics(b);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("forbidden key present: authToken");
  });

  it("rejects bundle with forbidden key nested inside telemetry array", () => {
    const b = validBundle();
    b.telemetry = [{ t: 1, event: "x", detail: { noteBody: "leak" } }];
    const r = validateDiagnostics(b);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("forbidden key present: noteBody");
  });

  it("rejects telemetry event whose detail exceeds MAX_TELEMETRY_DETAIL_BYTES", () => {
    const b = validBundle();
    const bigString = "x".repeat(MAX_TELEMETRY_DETAIL_BYTES + 50);
    b.telemetry = [{ t: 1, event: "big", detail: { blob: bigString } }];
    const r = validateDiagnostics(b);
    expect(r.ok).toBe(false);
    expect(
      r.errors.some((e) => e.includes(`telemetry[0].detail exceeds ${MAX_TELEMETRY_DETAIL_BYTES}`)),
    ).toBe(true);
  });

  it("accepts telemetry event whose detail is exactly at the byte cap", () => {
    const b = validBundle();
    // Fit a payload right under the cap so we prove the boundary works.
    const pad = "x".repeat(MAX_TELEMETRY_DETAIL_BYTES - `{"pad":""}`.length);
    b.telemetry = [{ t: 1, event: "edge", detail: { pad } }];
    const r = validateDiagnostics(b);
    expect(r).toEqual({ ok: true, errors: [] });
});

describe("truncateTelemetryDetails", () => {
  const bundleWith = (telemetry) => ({
    kind: DIAGNOSTICS_KIND,
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    at: "2026-07-09T12:00:00.000Z",
    extensionVersion: "1.3.6",
    handshake: { extensionProtocol: 2, appProtocol: 2, appBuildId: "a", ready: true, versionMismatch: null },
    load: {
      iframeSrc: "https://note.syrin.online/",
      iframeLoaded: true,
      retryCount: 0,
      appReachable: "online-unverified",
    },
    cspFrameAncestors: {
      inspected: false,
      ok: null,
      csp: null,
      reason: "not-inspected",
    },
    messageTimeline: [],
    telemetry,
    telemetryEnabled: true,
    debugLines: [],
  });

  it("truncates oversized detail into a bounded preview object and passes validation", () => {
    const big = "x".repeat(MAX_TELEMETRY_DETAIL_BYTES + 500);
    const truncated = truncateTelemetryDetails(bundleWith([{ t: 1, event: "big", detail: { blob: big } }]));
    const evt = truncated.telemetry[0];
    expect(evt.detail.truncated).toBe(true);
    expect(evt.detail.bytes).toBeGreaterThan(MAX_TELEMETRY_DETAIL_BYTES);
    expect(evt.detail.limit).toBe(MAX_TELEMETRY_DETAIL_BYTES);
    expect(JSON.stringify(evt.detail).length).toBeLessThanOrEqual(MAX_TELEMETRY_DETAIL_BYTES);
    expect(validateDiagnostics(truncated).ok).toBe(true);
  });

  it("leaves in-range details untouched (no distortion of the panel data)", () => {
    const original = bundleWith([{ t: 1, event: "ok", detail: { k: "v" } }]);
    const truncated = truncateTelemetryDetails(original);
    expect(truncated.telemetry[0]).toBe(original.telemetry[0]);
    expect(truncated.telemetry[0].detail).toEqual({ k: "v" });
  });

  it("returns a new bundle object without mutating the input (panel keeps raw data)", () => {
    const big = "y".repeat(MAX_TELEMETRY_DETAIL_BYTES + 100);
    const original = bundleWith([{ t: 1, event: "big", detail: { blob: big } }]);
    const before = JSON.stringify(original);
    truncateTelemetryDetails(original);
    expect(JSON.stringify(original)).toBe(before);
  });
});
});
