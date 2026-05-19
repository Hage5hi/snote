// Contract test: i18n-allowlist-report.json must match the shape
// documented in docs/i18n-allowlist-report.md. If a field is renamed,
// added, or has its type changed, this test fails and the docs need to
// be updated in lock-step (or vice-versa).
import { describe, expect, it } from "vitest";
import { runAllowlistCheck, type RunReport } from "../i18n-allowlist-check";

describe("i18n-allowlist-report.json — documented shape", () => {
  // Run silently against the real repo so we exercise the exact code path
  // that produces the file CI uploads.
  const report: RunReport = runAllowlistCheck({ silent: true });

  it("has the three top-level verdict booleans", () => {
    expect(typeof report.ok).toBe("boolean");
    expect(typeof report.schemaOk).toBe("boolean");
    expect(typeof report.driftOk).toBe("boolean");
  });

  it("has totals with exactly the four documented numeric fields", () => {
    expect(report.totals).toBeDefined();
    expect(Object.keys(report.totals).sort()).toEqual(
      ["entries", "schemaErrors", "missing", "stale"].sort(),
    );
    for (const k of ["entries", "schemaErrors", "missing", "stale"] as const) {
      expect(typeof report.totals[k]).toBe("number");
      expect(report.totals[k]).toBeGreaterThanOrEqual(0);
    }
  });

  it("derives `ok` from schemaOk + driftOk consistently", () => {
    if (report.ok) {
      expect(report.schemaOk).toBe(true);
      expect(report.driftOk).toBe(true);
      expect(report.totals.schemaErrors).toBe(0);
      expect(report.totals.missing).toBe(0);
      expect(report.totals.stale).toBe(0);
    }
  });

  it("entries[] rows match the documented field set", () => {
    expect(Array.isArray(report.entries)).toBe(true);
    expect(report.entries.length).toBe(report.totals.entries);
    for (const e of report.entries) {
      expect(Object.keys(e).sort()).toEqual(
        [
          "index",
          "file",
          "reason",
          "schemaOk",
          "fileExists",
          "duplicate",
          "matchedInSource",
          "matchedSites",
          "errors",
        ].sort(),
      );
      expect(typeof e.index).toBe("number");
      expect(typeof e.file).toBe("string");
      expect(typeof e.reason).toBe("string");
      expect(typeof e.schemaOk).toBe("boolean");
      expect(typeof e.fileExists).toBe("boolean");
      expect(typeof e.duplicate).toBe("boolean");
      expect(typeof e.matchedInSource).toBe("boolean");
      expect(Array.isArray(e.matchedSites)).toBe(true);
      for (const s of e.matchedSites) {
        expect(typeof s.file).toBe("string");
        expect(typeof s.line).toBe("number");
      }
      expect(Array.isArray(e.errors)).toBe(true);
      for (const err of e.errors) expect(typeof err).toBe("string");
    }
  });

  it("missing[] rows are { file, reason, line }", () => {
    expect(Array.isArray(report.missing)).toBe(true);
    expect(report.missing.length).toBe(report.totals.missing);
    for (const m of report.missing) {
      expect(typeof m.file).toBe("string");
      expect(typeof m.reason).toBe("string");
      expect(typeof m.line).toBe("number");
    }
  });

  it("stale[] is an array of `<file>::<reason>` strings", () => {
    expect(Array.isArray(report.stale)).toBe(true);
    expect(report.stale.length).toBe(report.totals.stale);
    for (const s of report.stale) {
      expect(typeof s).toBe("string");
      expect(s).toContain("::");
    }
  });

  it("groupedSchemaErrors rows are { group, messages[] }", () => {
    expect(Array.isArray(report.groupedSchemaErrors)).toBe(true);
    for (const g of report.groupedSchemaErrors) {
      expect(typeof g.group).toBe("string");
      expect(Array.isArray(g.messages)).toBe(true);
      for (const m of g.messages) expect(typeof m).toBe("string");
    }
  });

  it("has exactly the top-level keys documented in docs/i18n-allowlist-report.md", () => {
    expect(Object.keys(report).sort()).toEqual(
      [
        "ok",
        "schemaOk",
        "driftOk",
        "totals",
        "groupedSchemaErrors",
        "entries",
        "missing",
        "stale",
      ].sort(),
    );
  });
});
