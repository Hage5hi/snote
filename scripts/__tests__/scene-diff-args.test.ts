// Unit tests for scripts/_helpers/scene-diff-args.ts.
//
// Verifies:
//   1. Literal --scene-diff <id>=<ratio> sets per-scene overrides + env.
//   2. Wildcard --scene-diff "neon-*=0.05" expands against the provided
//      registry id list and reports the expansion.
//   3. Unknown literal ids warn (default) and are recorded in `unknown`.
//   4. --strict-scene-diff causes process.exit on unknown id / empty glob.
//   5. --chrome-diff sets CHROME_DIFF_RATIO; invalid values are ignored.
//   6. SCENE_DIFF_HELP includes the wildcard-quoting example reviewers need.
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  parseSceneDiffFlags,
  SCENE_DIFF_HELP,
} from "../_helpers/scene-diff-args";

const KNOWN = [
  "none",
  "cyber-linh-khi",
  "ethereal-aurora",
  "obsidian-ink",
  "digital-constellation",
  "neon-vapor",
  "terminal-boot",
];

beforeEach(() => {
  delete process.env.SCENE_DIFF_RATIOS;
  delete process.env.CHROME_DIFF_RATIO;
});

describe("parseSceneDiffFlags", () => {
  it("applies literal scene-diff overrides and sets env", () => {
    const r = parseSceneDiffFlags(
      ["--scene-diff", "neon-vapor=0.05", "--scene-diff", "obsidian-ink=0.012"],
      { knownSceneIds: KNOWN },
    );
    expect(r.overrides).toEqual({ "neon-vapor": 0.05, "obsidian-ink": 0.012 });
    expect(r.unknown).toEqual([]);
    expect(r.expansions).toEqual([]);
    expect(JSON.parse(r.env.SCENE_DIFF_RATIOS!)).toEqual({
      "neon-vapor": 0.05,
      "obsidian-ink": 0.012,
    });
  });

  it("expands wildcard patterns against known ids", () => {
    const r = parseSceneDiffFlags(["--scene-diff", "neon-*=0.05"], {
      knownSceneIds: KNOWN,
    });
    expect(r.overrides).toEqual({ "neon-vapor": 0.05 });
    expect(r.expansions).toHaveLength(1);
    expect(r.expansions[0]).toMatchObject({
      pattern: "neon-*",
      ids: ["neon-vapor"],
      ratio: 0.05,
    });
  });

  it("expands wildcards matching multiple scenes", () => {
    const r = parseSceneDiffFlags(["--scene-diff", "*-vapor=0.07"], {
      knownSceneIds: KNOWN,
    });
    expect(r.overrides).toEqual({ "neon-vapor": 0.07 });
    expect(r.expansions[0].ids).toEqual(["neon-vapor"]);
  });

  it("warns and records unknown literal ids without strict", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = parseSceneDiffFlags(["--scene-diff", "bogus-id=0.05"], {
      knownSceneIds: KNOWN,
    });
    expect(r.unknown).toEqual(["bogus-id"]);
    expect(r.overrides).toEqual({}); // not silently applied
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns and records wildcards that match nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = parseSceneDiffFlags(["--scene-diff", "zzz-*=0.05"], {
      knownSceneIds: KNOWN,
    });
    expect(r.unknown).toEqual(["zzz-*"]);
    expect(r.expansions).toEqual([]);
    warn.mockRestore();
  });

  it("--strict-scene-diff exits non-zero on unknown literal id", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);
    expect(() =>
      parseSceneDiffFlags(
        ["--strict-scene-diff", "--scene-diff", "typo-scene=0.05"],
        { knownSceneIds: KNOWN },
      ),
    ).toThrow(/exit:2/);
    expect(err).toHaveBeenCalled();
    exit.mockRestore();
    err.mockRestore();
  });

  it("--strict-scene-diff exits on a wildcard with zero matches", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);
    expect(() =>
      parseSceneDiffFlags(
        ["--strict-scene-diff", "--scene-diff", "noop-*=0.05"],
        { knownSceneIds: KNOWN },
      ),
    ).toThrow(/exit:2/);
    exit.mockRestore();
    err.mockRestore();
  });

  it("parses --chrome-diff and sets CHROME_DIFF_RATIO env", () => {
    const r = parseSceneDiffFlags(["--chrome-diff", "0.018"], {
      knownSceneIds: KNOWN,
    });
    expect(r.chromeDiff).toBe(0.018);
    expect(r.env.CHROME_DIFF_RATIO).toBe("0.018");
  });

  it("ignores invalid --chrome-diff value without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = parseSceneDiffFlags(["--chrome-diff", "notanumber"], {
      knownSceneIds: KNOWN,
    });
    expect(r.chromeDiff).toBeUndefined();
    expect(r.env.CHROME_DIFF_RATIO).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("preserves pre-existing SCENE_DIFF_RATIOS env values", () => {
    process.env.SCENE_DIFF_RATIOS = "obsidian-ink=0.011";
    const r = parseSceneDiffFlags(["--scene-diff", "neon-vapor=0.05"], {
      knownSceneIds: KNOWN,
    });
    expect(r.overrides).toEqual({
      "obsidian-ink": 0.011,
      "neon-vapor": 0.05,
    });
  });

  // ---- Precedence: multiple flags overlapping the same scene id ----
  //
  // The rule is "last flag wins" across literal + wildcard combinations.
  // These tests pin that behaviour so a future refactor of the parser
  // can't silently change the order in which overrides are folded in.
  it("last --scene-diff wins when two literal flags target the same id", () => {
    const r = parseSceneDiffFlags(
      [
        "--scene-diff", "neon-vapor=0.03",
        "--scene-diff", "neon-vapor=0.07",
      ],
      { knownSceneIds: KNOWN },
    );
    expect(r.overrides["neon-vapor"]).toBe(0.07);
  });

  it("a later literal --scene-diff overrides an earlier wildcard match", () => {
    const r = parseSceneDiffFlags(
      [
        "--scene-diff", "neon-*=0.05",
        "--scene-diff", "neon-vapor=0.09",
      ],
      { knownSceneIds: KNOWN },
    );
    expect(r.overrides["neon-vapor"]).toBe(0.09);
    // The wildcard expansion is still reported so the CI summary can
    // show what *would* have applied — but the resolved ratio is the
    // later, more-specific flag.
    expect(r.expansions[0]).toMatchObject({
      pattern: "neon-*",
      ids: ["neon-vapor"],
      ratio: 0.05,
    });
  });

  it("a later wildcard --scene-diff overrides an earlier literal", () => {
    const r = parseSceneDiffFlags(
      [
        "--scene-diff", "neon-vapor=0.09",
        "--scene-diff", "neon-*=0.05",
      ],
      { knownSceneIds: KNOWN },
    );
    expect(r.overrides["neon-vapor"]).toBe(0.05);
  });

  it("last wildcard wins when two overlapping wildcards target the same ids", () => {
    const r = parseSceneDiffFlags(
      [
        "--scene-diff", "*=0.01",
        "--scene-diff", "neon-*=0.05",
      ],
      { knownSceneIds: KNOWN },
    );
    // `neon-vapor` was matched by both; the later `neon-*` wins.
    expect(r.overrides["neon-vapor"]).toBe(0.05);
    // Other scenes only matched by the earlier `*` keep its value.
    expect(r.overrides["obsidian-ink"]).toBe(0.01);
  });

  // ---- --chrome-scene-diff (per-scene chrome threshold via globs) ----
  it("parses --chrome-scene-diff into chromeOverrides + env", () => {
    const r = parseSceneDiffFlags(
      ["--chrome-scene-diff", "neon-*=0.02"],
      { knownSceneIds: KNOWN },
    );
    expect(r.chromeOverrides).toEqual({ "neon-vapor": 0.02 });
    expect(r.overrides).toEqual({}); // does NOT cross-pollute the scene axis
    expect(JSON.parse(r.env.CHROME_SCENE_DIFF_RATIOS!)).toEqual({
      "neon-vapor": 0.02,
    });
    const exp = r.expansions.find((e) => e.pattern === "neon-*");
    expect(exp?.axis).toBe("chrome");
  });

  it("--chrome-scene-diff and --scene-diff do not overwrite each other", () => {
    const r = parseSceneDiffFlags(
      [
        "--scene-diff", "neon-vapor=0.09",
        "--chrome-scene-diff", "neon-vapor=0.02",
      ],
      { knownSceneIds: KNOWN },
    );
    expect(r.overrides["neon-vapor"]).toBe(0.09);
    expect(r.chromeOverrides["neon-vapor"]).toBe(0.02);
  });
});

describe("SCENE_DIFF_HELP", () => {
  it("documents wildcard quoting", () => {
    expect(SCENE_DIFF_HELP).toContain("--scene-diff");
    expect(SCENE_DIFF_HELP).toContain("--chrome-diff");
    expect(SCENE_DIFF_HELP).toContain("--chrome-scene-diff");
    expect(SCENE_DIFF_HELP).toContain("--strict-scene-diff");
    // The quoted glob example is the one reviewers most often get wrong.
    expect(SCENE_DIFF_HELP).toMatch(/"neon-\*=0\.05"/);
    // Precedence rule is stated so reviewers don't have to read the parser.
    expect(SCENE_DIFF_HELP).toMatch(/LAST flag/);
  });
});
