// Tests for new sticky replay infrastructure additions:
// - backward-compatible schema acceptance (v1 minor revisions)
// - --fields subset filter on --validate-only
// - standardized exit codes (USAGE/IO/PARSE/SCHEMA)
// - sticky-artifacts-manifest validator CLI
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runReplay as runOverlapReplay } from "../ci-sticky-newest-wins-overlap-replay";
import { runFuzzReplay } from "../ci-sticky-fuzz-failure-replay";
import { runValidateManifest } from "../ci-sticky-validate-artifacts-manifest";
import {
  isAcceptedSchema,
  filterProblemsByPath,
  validateOverlapReplayResult,
  validateManifest,
} from "../_helpers/sticky-replay-schemas";

describe("backward-compatible schema acceptance", () => {
  it("accepts the exact v1 literal", () => {
    expect(isAcceptedSchema("sticky-replay/v1", ["sticky-replay/v1"])).toBe(true);
  });
  it("accepts additive v1 minor revisions like v1.1, v1.2", () => {
    expect(isAcceptedSchema("sticky-replay/v1.1", ["sticky-replay/v1"])).toBe(true);
    expect(isAcceptedSchema("sticky-replay/v1.42", ["sticky-replay/v1"])).toBe(true);
  });
  it("rejects v2 and unrelated families", () => {
    expect(isAcceptedSchema("sticky-replay/v2", ["sticky-replay/v1"])).toBe(false);
    expect(isAcceptedSchema("other/v1", ["sticky-replay/v1"])).toBe(false);
    expect(isAcceptedSchema(42, ["sticky-replay/v1"])).toBe(false);
  });
  it("the overlap validator accepts a v1.1 document end-to-end", () => {
    const doc = {
      schema: "sticky-replay/v1.1",
      scenario: "s",
      headScanLines: 1,
      strategy: "delete",
      action: "u",
      selectedId: 1,
      cleanedIds: [],
      usedFullScan: false,
      scanStats: {},
      finalIds: [1],
      timestamp: "t",
    };
    expect(validateOverlapReplayResult(doc)).toEqual([]);
  });
});

describe("filterProblemsByPath", () => {
  it("keeps schema/root errors and entries matching the prefix", () => {
    const problems = [
      'schema="x" (expected ...) at path .schema',
      ".inputs.markerLiteral is missing or not a string (got: undefined)",
      ".matcher.headScan is missing or not an object (got: undefined)",
      ".timestamp is missing or not a string (got: undefined)",
    ];
    const filtered = filterProblemsByPath(problems, ["inputs"]);
    expect(filtered).toHaveLength(2); // schema + inputs.*
    expect(filtered.join("\n")).toMatch(/inputs\.markerLiteral/);
    expect(filtered.join("\n")).not.toMatch(/timestamp/);
  });
});

describe("standardized replay CLI exit codes", () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sticky-codes-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("overlap: unknown flag → 1 (USAGE)", async () => {
    expect(await runOverlapReplay(["--no-such-flag"])).toBe(1);
  });
  it("overlap: missing file → 2 (IO)", async () => {
    expect(await runOverlapReplay(["--validate-only", join(dir, "missing.json")])).toBe(2);
  });
  it("overlap: bad JSON → 3 (PARSE)", async () => {
    const f = join(dir, "broken.json");
    writeFileSync(f, "{{not json", "utf8");
    expect(await runOverlapReplay(["--validate-only", f])).toBe(3);
  });
  it("overlap: schema fail → 4 (SCHEMA)", async () => {
    const f = join(dir, "wrong.json");
    writeFileSync(f, JSON.stringify({ schema: "other/v1" }), "utf8");
    expect(await runOverlapReplay(["--validate-only", f])).toBe(4);
  });
  it("fuzz: missing file → 2 (IO)", async () => {
    expect(await runFuzzReplay(["--validate-only", join(dir, "missing.json")])).toBe(2);
  });

  it("overlap --validate-only --fields scopes problems and reports OK when scoped clean", async () => {
    // A doc that's wrong everywhere EXCEPT scanStats.
    const f = join(dir, "partial.json");
    writeFileSync(
      f,
      JSON.stringify({ schema: "sticky-replay/v1", scanStats: {} }),
      "utf8",
    );
    // With --fields scanStats, the only path-matching problem is none →
    // schema mismatch is suppressed since schema matches; result OK.
    const code = await runOverlapReplay([
      "--validate-only", f, "--fields", "scanStats",
    ]);
    expect(code).toBe(0);
  });
});

describe("ci-sticky-validate-artifacts-manifest CLI", () => {
  let dir: string;
  let logs: string[];
  let errs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "manifest-"));
    logs = [];
    errs = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    errSpy = vi.spyOn(console, "error").mockImplementation((...a) => errs.push(a.join(" ")));
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  function writeBundleFile(rel: string, content: string): { path: string; size: number } {
    const p = join(dir, rel);
    writeFileSync(p, content, "utf8");
    return { path: p, size: Buffer.byteLength(content, "utf8") };
  }

  it("returns OK for a manifest whose entries all exist with matching sizes", async () => {
    const a = writeBundleFile("a.json", '{"a":1}');
    const b = writeBundleFile("b.json", '{"b":2}');
    const manifest = {
      schema: "sticky-artifacts-manifest/v1",
      runUrl: "https://example/run#artifacts",
      entries: [
        { bundle: "sticky-replay", path: a.path, basename: "a.json", sizeBytes: a.size, downloadUrl: "https://example/run#artifacts" },
        { bundle: "sticky-fuzz-failures", path: b.path, basename: "b.json", sizeBytes: b.size, downloadUrl: "https://example/run#artifacts" },
      ],
    };
    const mp = join(dir, "manifest.json");
    writeFileSync(mp, JSON.stringify(manifest), "utf8");
    const code = await runValidateManifest([mp, "--base", dir]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/OK:.*2 entries/);
  });

  it("returns EXIT_OTHER (5) when a listed file is missing", async () => {
    const manifest = {
      schema: "sticky-artifacts-manifest/v1",
      runUrl: "u",
      entries: [
        { bundle: "sticky-replay", path: join(dir, "ghost.json"), basename: "ghost.json", sizeBytes: 10, downloadUrl: "u" },
      ],
    };
    const mp = join(dir, "manifest.json");
    writeFileSync(mp, JSON.stringify(manifest), "utf8");
    expect(await runValidateManifest([mp])).toBe(5);
    expect(errs.join("\n")).toMatch(/file not found/);
  });

  it("returns EXIT_OTHER (5) when a listed file's size mismatches", async () => {
    const f = writeBundleFile("c.json", "hello");
    const manifest = {
      schema: "sticky-artifacts-manifest/v1",
      runUrl: "u",
      entries: [
        { bundle: "sticky-replay", path: f.path, basename: "c.json", sizeBytes: f.size + 99, downloadUrl: "u" },
      ],
    };
    const mp = join(dir, "manifest.json");
    writeFileSync(mp, JSON.stringify(manifest), "utf8");
    expect(await runValidateManifest([mp])).toBe(5);
    expect(errs.join("\n")).toMatch(/size mismatch/);
  });

  it("returns EXIT_SCHEMA (4) for a structurally invalid manifest", async () => {
    const mp = join(dir, "bad.json");
    writeFileSync(mp, JSON.stringify({ schema: "other/v1" }), "utf8");
    expect(await runValidateManifest([mp])).toBe(4);
    expect(errs.join("\n")).toMatch(/failed schema validation/);
  });

  it("returns EXIT_PARSE (3) for non-JSON input", async () => {
    const mp = join(dir, "bad.json");
    writeFileSync(mp, "nope", "utf8");
    expect(await runValidateManifest([mp])).toBe(3);
  });

  it("returns EXIT_IO (2) when the manifest file does not exist", async () => {
    expect(await runValidateManifest([join(dir, "nope.json")])).toBe(2);
  });

  it("validateManifest helper flags missing entry fields", () => {
    const probs = validateManifest({
      schema: "sticky-artifacts-manifest/v1",
      runUrl: "u",
      entries: [{ bundle: "x" }],
    });
    const j = probs.join("\n");
    expect(j).toMatch(/entries\[0\]\.path/);
    expect(j).toMatch(/entries\[0\]\.basename/);
    expect(j).toMatch(/entries\[0\]\.sizeBytes/);
  });
});
