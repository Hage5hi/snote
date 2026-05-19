// Pins the CLI surface of ci-sticky-pr-comment-upsert:
//   - HELP_TEXT documents the default cleanup strategy and the
//     delete-vs-lock tradeoff (so `--help` in CI is self-explanatory).
//   - parseCliConfig honors flags AND env vars, with the documented
//     precedence (flags > env > defaults).
//   - Invalid strategy values raise loudly when passed via --flag
//     (we'd rather fail CI than silently fall back).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLEANUP_STRATEGY,
  HELP_TEXT,
  MARKER_HEAD_SCAN_LINES,
  parseCliConfig,
} from "../ci-sticky-pr-comment-upsert";

describe("HELP_TEXT — documents cleanup strategies", () => {
  it("names both strategies and identifies the default", () => {
    expect(HELP_TEXT).toMatch(/--cleanup-strategy/);
    expect(HELP_TEXT).toMatch(/delete \(DEFAULT\)/);
    expect(HELP_TEXT).toMatch(/\block\b/);
    expect(HELP_TEXT).toMatch(/tombstone/i);
    expect(HELP_TEXT).toMatch(/Falls back to "lock"/);
  });

  it("documents the STICKY_CLEANUP_STRATEGY env var", () => {
    expect(HELP_TEXT).toContain("STICKY_CLEANUP_STRATEGY");
    expect(HELP_TEXT).toContain("STICKY_HEAD_SCAN_LINES");
  });

  it("documents the default head-scan window", () => {
    expect(HELP_TEXT).toContain(`Default: ${MARKER_HEAD_SCAN_LINES}`);
  });

  it("default strategy in code matches what HELP_TEXT advertises", () => {
    expect(DEFAULT_CLEANUP_STRATEGY).toBe("delete");
    expect(HELP_TEXT).toMatch(/Default: delete/);
  });
});

describe("parseCliConfig — flags + env vars", () => {
  it("defaults: no flags, no env → delete + head-scan default", () => {
    const c = parseCliConfig([], {});
    expect(c.cleanupStrategy).toBe("delete");
    expect(c.headScanLines).toBe(MARKER_HEAD_SCAN_LINES);
    expect(c.help).toBe(false);
  });

  it("env: STICKY_CLEANUP_STRATEGY=lock is honored", () => {
    const c = parseCliConfig([], { STICKY_CLEANUP_STRATEGY: "lock" });
    expect(c.cleanupStrategy).toBe("lock");
  });

  it("env: STICKY_HEAD_SCAN_LINES is honored when a positive integer", () => {
    expect(parseCliConfig([], { STICKY_HEAD_SCAN_LINES: "8" }).headScanLines).toBe(8);
  });

  it("env: invalid strategy is silently ignored (env is best-effort)", () => {
    const c = parseCliConfig([], { STICKY_CLEANUP_STRATEGY: "nuke" });
    expect(c.cleanupStrategy).toBe("delete");
  });

  it("flag wins over env", () => {
    const c = parseCliConfig(
      ["--cleanup-strategy", "lock"],
      { STICKY_CLEANUP_STRATEGY: "delete" },
    );
    expect(c.cleanupStrategy).toBe("lock");
  });

  it("flag --cleanup-strategy with bad value THROWS (strict)", () => {
    expect(() => parseCliConfig(["--cleanup-strategy", "nuke"])).toThrow(/cleanup strategy/);
  });

  it("flag --head-scan-lines with bad value THROWS (strict)", () => {
    expect(() => parseCliConfig(["--head-scan-lines", "0"])).toThrow();
    expect(() => parseCliConfig(["--head-scan-lines", "-2"])).toThrow();
    expect(() => parseCliConfig(["--head-scan-lines", "abc"])).toThrow();
  });

  it("parses --marker and --body-file", () => {
    const c = parseCliConfig([
      "--marker", "<!-- m -->",
      "--body-file", "reports/x.md",
      "--cleanup-strategy", "delete",
    ]);
    expect(c.marker).toBe("<!-- m -->");
    expect(c.bodyFile).toBe("reports/x.md");
    expect(c.cleanupStrategy).toBe("delete");
  });

  it("--help is recognized", () => {
    expect(parseCliConfig(["--help"]).help).toBe(true);
    expect(parseCliConfig(["-h"]).help).toBe(true);
  });

  it("unknown flag throws", () => {
    expect(() => parseCliConfig(["--frobnicate"])).toThrow(/Unknown flag/);
  });
});
