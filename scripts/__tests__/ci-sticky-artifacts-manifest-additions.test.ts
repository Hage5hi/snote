// Tests for the latest sticky-artifacts additions:
//   1. --bundle filter on the manifest generator
//   2. Enhanced glob validation error listing candidates + sizes
//   3. Strict schema validation for sticky-validate-summary/v1
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGenerateManifest } from "../ci-sticky-generate-artifacts-manifest";
import { runValidateManifest } from "../ci-sticky-validate-artifacts-manifest";
import { validateValidateSummary } from "../_helpers/sticky-replay-schemas";

let dir = "";
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sticky-add-"));
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

describe("generator --bundle filter", () => {
  beforeEach(() => {
    mkdirSync(join(dir, "sticky-replay"), { recursive: true });
    mkdirSync(join(dir, "sticky-fuzz-failures"), { recursive: true });
    writeFileSync(join(dir, "sticky-replay", "r.json"), "RR");
    writeFileSync(join(dir, "sticky-fuzz-failures", "f.json"), "FFF");
  });

  it("default scans both bundles", async () => {
    const out = join(dir, "all.json");
    expect(await runGenerateManifest(["--root", dir, "--out", out])).toBe(0);
    const m = JSON.parse(readFileSync(out, "utf8"));
    expect(m.entries.map((e: any) => e.bundle).sort()).toEqual([
      "sticky-fuzz-failures", "sticky-replay",
    ]);
  });

  it("--bundle sticky-replay restricts the scan", async () => {
    const out = join(dir, "r.json");
    expect(await runGenerateManifest([
      "--root", dir, "--out", out, "--bundle", "sticky-replay",
    ])).toBe(0);
    const m = JSON.parse(readFileSync(out, "utf8"));
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].bundle).toBe("sticky-replay");
  });

  it("--bundle sticky-fuzz-failures restricts the scan", async () => {
    const out = join(dir, "f.json");
    expect(await runGenerateManifest([
      "--root", dir, "--out", out, "--bundle", "sticky-fuzz-failures",
    ])).toBe(0);
    const m = JSON.parse(readFileSync(out, "utf8"));
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].bundle).toBe("sticky-fuzz-failures");
  });

  it("rejects unknown --bundle with USAGE (1)", async () => {
    const out = join(dir, "x.json");
    expect(await runGenerateManifest([
      "--root", dir, "--out", out, "--bundle", "not-a-bundle",
    ])).toBe(1);
  });
});

describe("glob validation — enhanced candidate listing", () => {
  it("lists every candidate with its byte size on multi-match", async () => {
    mkdirSync(join(dir, "sticky-replay"), { recursive: true });
    writeFileSync(join(dir, "sticky-replay", "coverage-a.json"), "AAAA");
    writeFileSync(join(dir, "sticky-replay", "coverage-b.json"), "BBBBBB");
    const manifestPath = join(dir, "m.json");
    writeFileSync(manifestPath, JSON.stringify({
      schema: "sticky-artifacts-manifest/v1",
      runUrl: "",
      entries: [{
        bundle: "sticky-replay",
        pattern: "sticky-replay/coverage-*.json",
        sizeBytes: 4,
        downloadUrl: "",
      }],
    }));
    const code = await runValidateManifest([manifestPath, "--base", dir]);
    expect(code).toBe(5); // EXIT_OTHER
    const errOut = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errOut).toContain("resolved to 2 files");
    expect(errOut).toContain("declared sizeBytes=4");
    expect(errOut).toContain("coverage-a.json (4B)");
    expect(errOut).toContain("coverage-b.json (6B)");
  });

  it("notes 'no candidates found' on zero matches", async () => {
    mkdirSync(join(dir, "sticky-replay"), { recursive: true });
    const manifestPath = join(dir, "m.json");
    writeFileSync(manifestPath, JSON.stringify({
      schema: "sticky-artifacts-manifest/v1",
      runUrl: "",
      entries: [{
        bundle: "sticky-replay",
        pattern: "sticky-replay/coverage-*.json",
        sizeBytes: 4,
        downloadUrl: "",
      }],
    }));
    const code = await runValidateManifest([manifestPath, "--base", dir]);
    expect(code).toBe(5);
    const errOut = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errOut).toContain("resolved to 0 files");
    expect(errOut).toContain("no candidates found under base");
  });
});

describe("sticky-validate-summary/v1 strict schema", () => {
  it("accepts a well-formed summary", () => {
    expect(validateValidateSummary({
      schema: "sticky-validate-summary/v1",
      target: "x.json",
      ok: true,
      exitCode: 0,
      schemaProblems: [],
      entryFailureCount: 0,
      entries: [],
    })).toEqual([]);
  });

  it("rejects wrong schema", () => {
    const probs = validateValidateSummary({
      schema: "other/v1",
      target: "x", ok: true, exitCode: 0,
      schemaProblems: [], entryFailureCount: 0, entries: [],
    });
    expect(probs.some((p) => p.includes("schema="))).toBe(true);
  });

  it("rejects wrong field types", () => {
    const probs = validateValidateSummary({
      schema: "sticky-validate-summary/v1",
      target: 42, ok: "yes", exitCode: "0",
      schemaProblems: [1], entryFailureCount: "n", entries: "x",
    });
    expect(probs.length).toBeGreaterThanOrEqual(5);
  });

  it("validator writes a schema-valid summary on success", async () => {
    mkdirSync(join(dir, "sticky-replay"), { recursive: true });
    const f = join(dir, "sticky-replay", "a.json");
    writeFileSync(f, "hi");
    const manifestPath = join(dir, "m.json");
    writeFileSync(manifestPath, JSON.stringify({
      schema: "sticky-artifacts-manifest/v1",
      runUrl: "",
      entries: [{
        bundle: "sticky-replay",
        path: "sticky-replay/a.json",
        basename: "a.json",
        sizeBytes: 2,
        downloadUrl: "",
      }],
    }));
    const summary = join(dir, "summary.json");
    expect(await runValidateManifest([
      manifestPath, "--base", dir, "--json-summary", summary,
    ])).toBe(0);
    const s = JSON.parse(readFileSync(summary, "utf8"));
    expect(validateValidateSummary(s)).toEqual([]);
    expect(s.schema).toBe("sticky-validate-summary/v1");
    expect(s.ok).toBe(true);
  });
});
