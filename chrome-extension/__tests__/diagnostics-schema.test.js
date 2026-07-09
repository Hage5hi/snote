import { describe, it, expect } from "vitest";
import {
  validateDiagnostics,
  DIAGNOSTICS_KIND,
  DIAGNOSTICS_SCHEMA_VERSION,
} from "../lib/diagnostics-schema.js";

const validBundle = () => ({
  kind: DIAGNOSTICS_KIND,
  schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
  at: "2026-07-09T12:00:00.000Z",
  extensionVersion: "1.3.5",
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
  },
  cspFrameAncestors: { ok: true, csp: "frame-ancestors 'self' chrome-extension://*", reason: null },
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
});
