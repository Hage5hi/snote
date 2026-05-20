// Tests for the four new sticky-artifact additions:
//   1. ci-sticky-generate-artifacts-manifest CLI
//   2. --json-summary on replay --validate-only + manifest validator
//   3. Manifest pointer with relative-path resolution in GH annotations
//   4. Glob pattern entries in sticky-artifacts-manifest/v1
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGenerateManifest } from "../ci-sticky-generate-artifacts-manifest";
import { runValidateManifest } from "../ci-sticky-validate-artifacts-manifest";
import { runReplay as runOverlapReplay } from "../ci-sticky-newest-wins-overlap-replay";
import { runFuzzReplay } from "../ci-sticky-fuzz-failure-replay";
import { resolveManifestGlob } from "../_helpers/sticky-manifest-glob";

describe("ci-sticky-generate-artifacts-manifest", () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sticky-gen-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("scans replay + fuzz subdirs and emits a valid manifest", async () => {
    mkdirSync(join(dir, "sticky-replay"), { recursive: true });
    mkdirSync(join(dir, "sticky-fuzz-failures"), { recursive: true });
    writeFileSync(join(dir, "sticky-replay", "a.json"), "AAAA", "utf8");
    writeFileSync(join(dir, "sticky-fuzz-failures", "b.json"), "BBBBBB", "utf8");
    const out = join(dir, "manifest.json");
    const code = await runGenerateManifest([
      "--root", dir, "--out", out, "--run-url", "https://example/run",
    ]);
    expect(code).toBe(0);
    const m = JSON.parse(readFileSync(out, "utf8"));
    expect(m.schema).toBe("sticky-artifacts-manifest/v1");
    expect(m.entries).toHaveLength(2);
    expect(m.entries[0].bundle).toBe("sticky-replay");
    expect(m.entries[0].sizeBytes).toBe(4);
    expect(m.entries[0].downloadUrl).toBe("https://example/run#entries-0");
    expect(m.entries[1].bundle).toBe("sticky-fuzz-failures");
    expect(m.entries[1].sizeBytes).toBe(6);
  });

  it("generated manifest passes the manifest validator", async () => {
    mkdirSync(join(dir, "sticky-replay"), { recursive: true });
    writeFileSync(join(dir, "sticky-replay", "x.json"), "hi", "utf8");
    const out = join(dir, "m.json");
    expect(await runGenerateManifest(["--root", dir, "--out", out])).toBe(0);
    expect(await runValidateManifest([out, "--base", dir])).toBe(0);
  });

  it("returns USAGE (1) when --root or --out are missing", async () => {
    expect(await runGenerateManifest(["--out", join(dir, "x.json")])).toBe(1);
    expect(await runGenerateManifest(["--root", dir])).toBe(1);
  });
});

describe("--json-summary on validators", () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sticky-summary-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("overlap --validate-only writes a passing summary", async () => {
    const f = join(dir, "ok.json");
    expect(await runOverlapReplay(["--out", f])).toBe(0);
    const summary = join(dir, "summary.json");
    expect(await runOverlapReplay(["--validate-only", f, "--json-summary", summary])).toBe(0);
    const s = JSON.parse(readFileSync(summary, "utf8"));
    expect(s.schema).toBe("sticky-validate-summary/v1");
    expect(s.ok).toBe(true);
    expect(s.exitCode).toBe(0);
    expect(s.problemCount).toBe(0);
  });

  it("overlap --validate-only writes a failing summary with problems", async () => {
    const f = join(dir, "bad.json");
    writeFileSync(f, JSON.stringify({ schema: "other/v1" }), "utf8");
    const summary = join(dir, "fail.json");
    expect(await runOverlapReplay(["--validate-only", f, "--json-summary", summary])).toBe(4);
    const s = JSON.parse(readFileSync(summary, "utf8"));
    expect(s.ok).toBe(false);
    expect(s.exitCode).toBe(4);
    expect(s.problemCount).toBeGreaterThan(0);
    expect(s.problems[0].message).toMatch(/schema=/);
  });

  it("fuzz --validate-only writes a summary on parse error", async () => {
    const f = join(dir, "broken.json");
    writeFileSync(f, "{{", "utf8");
    const summary = join(dir, "p.json");
    expect(await runFuzzReplay(["--validate-only", f, "--json-summary", summary])).toBe(3);
    const s = JSON.parse(readFileSync(summary, "utf8"));
    expect(s.exitCode).toBe(3);
    expect(s.problems[0].message).toMatch(/not valid JSON/);
  });

  it("manifest validator --json-summary records per-entry results", async () => {
    const good = join(dir, "g.json");
    writeFileSync(good, "1234", "utf8");
    const manifest = {
      schema: "sticky-artifacts-manifest/v1",
      runUrl: "u",
      entries: [
        { bundle: "sticky-replay", path: "g.json", basename: "g.json", sizeBytes: 4, downloadUrl: "u" },
        { bundle: "sticky-replay", path: "missing.json", basename: "missing.json", sizeBytes: 1, downloadUrl: "u" },
      ],
    };
    const mp = join(dir, "manifest.json");
    writeFileSync(mp, JSON.stringify(manifest), "utf8");
    const sum = join(dir, "sum.json");
    expect(await runValidateManifest([mp, "--base", dir, "--json-summary", sum])).toBe(5);
    const s = JSON.parse(readFileSync(sum, "utf8"));
    expect(s.ok).toBe(false);
    expect(s.entryFailureCount).toBe(1);
    expect(s.entries[0].ok).toBe(true);
    expect(s.entries[1].ok).toBe(false);
    expect(s.entries[1].problems.join(" ")).toMatch(/file not found/);
  });
});

describe("manifest pointer in GH annotations uses relative paths", () => {
  let dir: string;
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const prev = process.env.GITHUB_ACTIONS;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sticky-annot-"));
    logs = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.GITHUB_ACTIONS = "true";
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = prev;
  });

  it("computes relative path from artifact dir → manifest dir", async () => {
    // artifact at reports/sticky-replay/x.json, manifest at reports/manifest.json
    const artifactDir = join(dir, "sticky-replay");
    mkdirSync(artifactDir, { recursive: true });
    const artifactPath = join(artifactDir, "x.json");
    const manifestPath = join(dir, "manifest.json");
    const code = await runOverlapReplay([
      "--out", artifactPath, "--manifest", manifestPath,
    ]);
    expect(code).toBe(0);
    const annot = logs.find((l) => l.startsWith("::notice"));
    expect(annot).toBeTruthy();
    // The relative path from artifactDir to manifest should go up one level.
    expect(annot).toMatch(/manifest=\.\.[/\\]manifest\.json#entries\[bundle=sticky-replay,basename=x\.json\]/);
  });
});

describe("glob pattern support in manifest entries", () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let errs: string[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sticky-glob-"));
    errs = [];
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation((...a) => errs.push(a.join(" ")));
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolveManifestGlob finds * matches in the final segment", () => {
    writeFileSync(join(dir, "coverage-1.json"), "x", "utf8");
    writeFileSync(join(dir, "coverage-2.json"), "y", "utf8");
    writeFileSync(join(dir, "other.json"), "z", "utf8");
    const matches = resolveManifestGlob("coverage-*.json", dir);
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.includes("coverage-"))).toBe(true);
  });

  it("validates OK when pattern resolves to exactly one file with matching size", async () => {
    writeFileSync(join(dir, "coverage-abc.json"), "hello", "utf8");
    const manifest = {
      schema: "sticky-artifacts-manifest/v1",
      runUrl: "u",
      entries: [
        { bundle: "sticky-replay", pattern: "coverage-*.json", sizeBytes: 5, downloadUrl: "u" },
      ],
    };
    const mp = join(dir, "m.json");
    writeFileSync(mp, JSON.stringify(manifest), "utf8");
    expect(await runValidateManifest([mp, "--base", dir])).toBe(0);
  });

  it("fails when pattern resolves to more than one file", async () => {
    writeFileSync(join(dir, "coverage-1.json"), "x", "utf8");
    writeFileSync(join(dir, "coverage-2.json"), "y", "utf8");
    const manifest = {
      schema: "sticky-artifacts-manifest/v1",
      runUrl: "u",
      entries: [
        { bundle: "sticky-replay", pattern: "coverage-*.json", sizeBytes: 1, downloadUrl: "u" },
      ],
    };
    const mp = join(dir, "m.json");
    writeFileSync(mp, JSON.stringify(manifest), "utf8");
    expect(await runValidateManifest([mp, "--base", dir])).toBe(5);
    expect(errs.join("\n")).toMatch(/resolved to 2 files/);
  });

  it("fails when pattern matches one file but the size differs", async () => {
    writeFileSync(join(dir, "coverage-x.json"), "12345", "utf8");
    const manifest = {
      schema: "sticky-artifacts-manifest/v1",
      runUrl: "u",
      entries: [
        { bundle: "sticky-replay", pattern: "coverage-*.json", sizeBytes: 999, downloadUrl: "u" },
      ],
    };
    const mp = join(dir, "m.json");
    writeFileSync(mp, JSON.stringify(manifest), "utf8");
    expect(await runValidateManifest([mp, "--base", dir])).toBe(5);
    expect(errs.join("\n")).toMatch(/size mismatch/);
  });

  it("fails when pattern matches zero files", async () => {
    const manifest = {
      schema: "sticky-artifacts-manifest/v1",
      runUrl: "u",
      entries: [
        { bundle: "sticky-replay", pattern: "nothing-*.json", sizeBytes: 1, downloadUrl: "u" },
      ],
    };
    const mp = join(dir, "m.json");
    writeFileSync(mp, JSON.stringify(manifest), "utf8");
    expect(await runValidateManifest([mp, "--base", dir])).toBe(5);
    expect(errs.join("\n")).toMatch(/resolved to 0 files/);
  });
});
