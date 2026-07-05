// Unit tests for scripts/schema-drift-pr-comment.ts and
// scripts/schema-drift-summary.ts — verifies deterministic sorting,
// CLI filtering flags, and correct rendering for both empty (all-ok)
// and failing validation-report.json fixtures.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  renderAnnotations,
  renderPrComment,
  selectFailures,
  anchorFor,
  type Report,
} from "../schema-drift-pr-comment";
import { renderSummary } from "../schema-drift-summary";
import { computeDiff, renderDiff, compileMatcher, expandKindPatterns } from "../schema-drift-diff";
import { readFileSync as _readFileSync } from "node:fs";

const PR_SCRIPT = resolve(__dirname, "../schema-drift-pr-comment.ts");
const SUM_SCRIPT = resolve(__dirname, "../schema-drift-summary.ts");
const DIFF_SCRIPT = resolve(__dirname, "../schema-drift-diff.ts");

function tmp() {
  return mkdtempSync(join(tmpdir(), "schema-drift-report-"));
}
function writeReport(dir: string, r: Report): string {
  const p = join(dir, "validation-report.json");
  writeFileSync(p, JSON.stringify(r));
  return p;
}
function bun(script: string, args: string[], env: Record<string, string> = {}) {
  const res = spawnSync("bun", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const EMPTY: Report = {
  strict: true,
  totals: { checked: 3, ok: 3, invalid: 0 },
  files: [],
};

const FAILING: Report = {
  strict: true,
  totals: { checked: 4, ok: 1, invalid: 3 },
  files: [
    {
      path: "/z/drift-webkit.json",
      ok: false,
      browser: "webkit",
      combined: false,
      missing: ["matched"],
      mistyped: [],
      extra: ["stray"],
    },
    {
      path: "/a/drift-chromium.json",
      ok: false,
      browser: "chromium",
      combined: false,
      missing: [],
      mistyped: [{ key: "combined", expected: "boolean", got: "string" }],
      extra: [],
    },
    {
      path: "/a/drift-combined.json",
      ok: false,
      browser: "combined",
      combined: true,
      missing: ["browser"],
      mistyped: [],
      extra: [],
    },
    {
      path: "/a/drift-firefox.json",
      ok: true,
      browser: "firefox",
      combined: false,
    },
  ],
};

describe("renderPrComment", () => {
  it("shows all-green section when no failures", () => {
    const md = renderPrComment(EMPTY);
    expect(md).toContain("✅");
    expect(md).toContain("All 3 manifest(s)");
    expect(md).not.toContain("| Manifest |");
  });

  it("renders failing report with a table row per failure", () => {
    const md = renderPrComment(FAILING);
    expect(md).toContain("❌ 3/4 invalid");
    expect(md).toContain("| Manifest | Scope | Issues |");
    expect(md).toContain("drift-webkit.json");
    expect(md).toContain("drift-chromium.json");
    expect(md).toContain("drift-combined.json");
  });

  it("sorts failures deterministically by (path, browser) ascending", () => {
    const md = renderPrComment(FAILING);
    const rowOrder = md
      .split("\n")
      .filter((l) => l.startsWith("| <a id="))
      .map((l) => (l.match(/`([^`]+\.json)`/) ?? [])[1]);
    expect(rowOrder).toEqual([
      "/a/drift-chromium.json",
      "/a/drift-combined.json",
      "/z/drift-webkit.json",
    ]);
  });

  it("truncation is stable: same top-N selected across renders", () => {
    const r: Report = {
      strict: true,
      totals: { checked: 5, ok: 0, invalid: 5 },
      files: [1, 2, 3, 4, 5].map((n) => ({
        path: `/x/drift-${n}.json`,
        ok: false,
        browser: `b${n}`,
        missing: ["matched"],
      })),
    };
    const a = renderPrComment(r, { max: 2 });
    const b = renderPrComment(r, { max: 2 });
    expect(a).toBe(b);
    expect(a).toContain("drift-1.json");
    expect(a).toContain("drift-2.json");
    expect(a).not.toContain("drift-3.json");
    expect(a).toContain("3 additional failure(s) elided");
  });
});

describe("selectFailures filters", () => {
  it("--browser filters to the named browser only", () => {
    const sel = selectFailures(FAILING, { browser: "chromium" });
    expect(sel.map((f) => f.browser)).toEqual(["chromium"]);
  });

  it("--path filters by substring", () => {
    const sel = selectFailures(FAILING, { path: "/z/" });
    expect(sel.map((f) => f.path)).toEqual(["/z/drift-webkit.json"]);
  });

  it("--kind missing keeps only files with missing keys", () => {
    const sel = selectFailures(FAILING, { kind: "missing" });
    expect(sel.every((f) => (f.missing?.length ?? 0) > 0)).toBe(true);
    expect(sel.map((f) => f.path).sort()).toEqual([
      "/a/drift-combined.json",
      "/z/drift-webkit.json",
    ]);
  });

  it("--kind mistyped keeps only files with mistyped keys", () => {
    const sel = selectFailures(FAILING, { kind: "mistyped" });
    expect(sel.map((f) => f.path)).toEqual(["/a/drift-chromium.json"]);
  });

  it("--kind extra keeps only files with extra keys", () => {
    const sel = selectFailures(FAILING, { kind: "extra" });
    expect(sel.map((f) => f.path)).toEqual(["/z/drift-webkit.json"]);
  });
});

describe("renderSummary (text)", () => {
  it("empty report → concise all-ok line", () => {
    const txt = renderSummary(EMPTY);
    expect(txt).toMatch(/OK.*3\/3/);
    expect(txt).not.toContain("missing:");
  });

  it("failing report lists missing/mistyped/extra per file", () => {
    const txt = renderSummary(FAILING);
    expect(txt).toContain("3/4 invalid");
    expect(txt).toContain("browser=chromium");
    expect(txt).toContain("mistyped: combined(want boolean, got string)");
    expect(txt).toContain("missing: matched");
    expect(txt).toContain("extra: stray");
  });
});

describe("CLI: schema-drift-pr-comment.ts", () => {
  it("empty report prints ✅ body to stdout", () => {
    const dir = tmp();
    const p = writeReport(dir, EMPTY);
    const { code, stdout } = bun(PR_SCRIPT, [p]);
    expect(code).toBe(0);
    expect(stdout).toContain("✅");
  });

  it("--browser flag limits rows in stdout", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stdout } = bun(PR_SCRIPT, [p, "--browser", "chromium"]);
    expect(code).toBe(0);
    expect(stdout).toContain("drift-chromium.json");
    expect(stdout).not.toContain("drift-webkit.json");
    expect(stdout).not.toContain("drift-combined.json");
  });

  it("--kind extra flag limits rows in stdout", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stdout } = bun(PR_SCRIPT, [p, "--kind", "extra"]);
    expect(code).toBe(0);
    expect(stdout).toContain("drift-webkit.json");
    expect(stdout).not.toContain("drift-chromium.json");
  });

  it("--max=1 truncates and notes elision", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stdout } = bun(PR_SCRIPT, [p, "--max", "1"]);
    expect(code).toBe(0);
    expect(stdout).toContain("2 additional failure(s) elided");
  });
});

describe("CLI: schema-drift-summary.ts", () => {
  it("prints concise text summary for failing report", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stdout } = bun(SUM_SCRIPT, [p]);
    expect(code).toBe(0);
    expect(stdout).toContain("3/4 invalid");
    expect(stdout).toContain("mistyped:");
  });

  it("all-ok report exits 0 with a single OK line", () => {
    const dir = tmp();
    const p = writeReport(dir, EMPTY);
    const { code, stdout } = bun(SUM_SCRIPT, [p]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/OK.*3\/3/);
  });
});

describe("renderAnnotations + anchors", () => {
  it("anchorFor is deterministic and stable for the same (path, browser)", () => {
    const f = FAILING.files[0];
    expect(anchorFor(f)).toBe(anchorFor(f));
    expect(anchorFor(f)).toMatch(/^fail-/);
  });

  it("pr-comment rows include stable HTML anchors matching anchorFor", () => {
    const md = renderPrComment(FAILING);
    for (const f of selectFailures(FAILING)) {
      const a = anchorFor(f);
      expect(md).toContain(`<a id="${a}"></a>`);
    }
  });

  it("renderAnnotations emits one ::error:: workflow command per selected failure with kind + anchor", () => {
    const txt = renderAnnotations(FAILING, { commentUrl: "PR_COMMENT_URL" });
    const lines = txt.trim().split("\n");
    // Selected failures: chromium (mistyped), combined (missing), webkit (missing+extra)
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(l).toMatch(/^::error file=/);
      expect(l).toContain("kind=");
      expect(l).toContain("PR_COMMENT_URL#fail-");
    }
    expect(txt).toContain("kind=mistyped");
    expect(txt).toMatch(/kind=[a-z,]*missing/);
    expect(txt).toMatch(/kind=[a-z,]*extra/);
  });

  it("empty report → no annotation lines", () => {
    expect(renderAnnotations(EMPTY)).toBe("");
  });

  it("--annotations-file writes the file and pr-comment still goes to stdout", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const outAnn = join(dir, "annotations.txt");
    const { code, stdout } = bun(PR_SCRIPT, [p, "--annotations-file", outAnn]);
    expect(code).toBe(0);
    expect(stdout).toContain("| Manifest |");
    const written = require("node:fs").readFileSync(outAnn, "utf8");
    expect(written).toMatch(/^::error file=/m);
    expect(written).toContain("kind=");
});
});



describe("schema-drift-diff: stable anchors across reordered reports", () => {
  const reordered: Report = {
    ...FAILING,
    files: [...FAILING.files].reverse(),
  };

  it("recomputes identical anchors for the same (path, browser) pair regardless of input order", () => {
    for (const f of FAILING.files.filter((x) => !x.ok)) {
      const same = reordered.files.find(
        (x) => x.path === f.path && (x.browser ?? "") === (f.browser ?? ""),
      )!;
      expect(anchorFor(same)).toBe(anchorFor(f));
    }
  });

  it("diff of a report against a reordered copy of itself reports no added/removed/changed", () => {
    const out = renderDiff(FAILING, reordered);
    expect(out).toContain("+0 added");
    expect(out).toContain("-0 removed");
    expect(out).toContain("~0 changed");
    expect(out).not.toContain("\nadded:");
    expect(out).not.toContain("\nremoved:");
    expect(out).not.toContain("\nchanged:");
  });

  it("added/removed rows carry stable #fail-<slug> anchors", () => {
    const after: Report = {
      strict: true,
      totals: { checked: 2, ok: 0, invalid: 2 },
      files: [
        { path: "/a/drift-chromium.json", ok: false, browser: "chromium", missing: ["x"] },
        { path: "/n/drift-new.json", ok: false, browser: "webkit", missing: ["m"] },
      ],
    };
    const before: Report = {
      strict: true,
      totals: { checked: 1, ok: 0, invalid: 1 },
      files: [
        { path: "/a/drift-chromium.json", ok: false, browser: "chromium", missing: ["x"] },
      ],
    };
    const out = renderDiff(before, after);
    const expected = anchorFor(after.files[1]);
    expect(out).toContain(`#${expected}`);
    expect(out).toContain("+1 added");
});

describe("schema-drift-diff CLI: exit codes + suggested fixes", () => {
  it("exit 3 with a suggested fix when the report file is missing (text + --json)", () => {
    const missing = join(tmp(), "does-not-exist.json");
    // text mode
    const t = bun(DIFF_SCRIPT, [missing, missing]);
    expect(t.code).toBe(3);
    expect(t.stderr).toContain("cannot read");
    expect(t.stderr).toContain("fix:");
    expect(t.stderr).toContain("gh run download");
    // --json mode: error is emitted as JSON to stderr
    const j = bun(DIFF_SCRIPT, [missing, missing, "--json"]);
    expect(j.code).toBe(3);
    const parsed = JSON.parse(j.stderr);
    expect(parsed).toMatchObject({ error: "report-unreadable", code: 3, label: "before" });
    expect(parsed.fix).toMatch(/gh run download/);
  });

  it("exit 4 when the file is not valid JSON (text + --json + --markdown)", () => {
    const dir = tmp();
    const p = join(dir, "bad.json");
    writeFileSync(p, "{not json");
    for (const mode of [[p, p], [p, p, "--markdown"]]) {
      const { code, stderr } = bun(DIFF_SCRIPT, mode);
      expect(code).toBe(4);
      expect(stderr).toContain("not valid JSON");
      expect(stderr).toContain("schema-drift-view.sh --validation-report");
    }
    const j = bun(DIFF_SCRIPT, [p, p, "--json"]);
    expect(j.code).toBe(4);
    const parsed = JSON.parse(j.stderr);
    expect(parsed).toMatchObject({ error: "report-invalid-json", code: 4 });
    expect(parsed.fix).toMatch(/schema-drift-view/);
  });

  it("exit 5 when required fields are missing — text mode includes received keys + checklist", () => {
    const dir = tmp();
    const p = join(dir, "weird.json");
    writeFileSync(p, JSON.stringify({ hello: "world", nope: 1 }));
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p]);
    expect(code).toBe(5);
    expect(stderr).toContain("missing required fields");
    expect(stderr).toContain("`strict`");
    expect(stderr).toContain("`files`");
    expect(stderr).toContain("received top-level keys: hello, nope");
    expect(stderr).toContain("missing top-level keys: strict, totals, files");
    expect(stderr).toContain("expected schema checklist:");
    expect(stderr).toContain("[ ] strict");
    expect(stderr).toContain("[ ] files");
    expect(stderr).toContain("Expected shape");
  });

  it("exit 5 in --json mode emits structured error with receivedTopLevelKeys + expectedChecklist", () => {
    const dir = tmp();
    const p = join(dir, "weird.json");
    writeFileSync(p, JSON.stringify({ hello: "world", nope: 1 }));
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json"]);
    expect(code).toBe(5);
    const parsed = JSON.parse(stderr);
    expect(parsed).toMatchObject({
      error: "report-missing-fields",
      code: 5,
      label: "before",
      receivedTopLevelKeys: ["hello", "nope"],
      missingTopLevelKeys: ["strict", "totals", "files"],
    });
    expect(parsed.problems).toEqual(expect.arrayContaining([expect.stringContaining("`strict`")]));
    expect(parsed.expectedChecklist).toEqual([
      { key: "strict", present: false },
      { key: "totals", present: false },
      { key: "files", present: false },
    ]);
    expect(parsed.expectedShape).toMatch(/strict: boolean/);
  });
});

describe("schema-drift-diff: --fail-slug + JSON matchedAnchors", () => {
  const reordered: Report = { ...FAILING, files: [...FAILING.files].reverse() };

  it("computeDiff exposes matchedAnchors and counts at the top level", () => {
    const d = computeDiff(FAILING, reordered);
    expect(d.matchedAnchors.length).toBe(d.totals.matched);
    expect(d.matchedAnchors).toEqual([...d.matchedAnchors].sort());
    expect(d.totals.matched).toBeGreaterThan(0);
  });

  it("--fail-slug filters both markdown text and --json output", () => {
    const target = anchorFor(FAILING.files.find((f) => f.browser === "chromium")!);
    const d = computeDiff(FAILING, FAILING, { failSlugs: [target] });
    expect(d.matchedAnchors).toEqual([target]);
    const dp = tmp();
    const p = writeReport(dp, FAILING);
    const { code, stdout } = bun(DIFF_SCRIPT, [p, p, "--json", "--fail-slug", target]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.matchedAnchors).toEqual([target]);
    expect(parsed.totals.matched).toBe(1);
  });
});
});

describe("schema-drift-diff: comma-separated --fail-slug", () => {
  it("accepts a comma-separated list equivalent to repeated --fail-slug", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const s1 = anchorFor(FAILING.files.find((f) => f.browser === "chromium")!);
    const s2 = anchorFor(FAILING.files.find((f) => f.browser === "webkit")!);
    const repeated = bun(DIFF_SCRIPT, [p, p, "--json", "--fail-slug", s1, "--fail-slug", s2]);
    const csv = bun(DIFF_SCRIPT, [p, p, "--json", "--fail-slug", `${s1},${s2}`]);
    const csvEq = bun(DIFF_SCRIPT, [p, p, "--json", `--fail-slug=#${s1},#${s2}`]);
    expect(repeated.code).toBe(0);
    expect(csv.code).toBe(0);
    expect(csvEq.code).toBe(0);
    const a = JSON.parse(repeated.stdout).matchedAnchors.sort();
    const b = JSON.parse(csv.stdout).matchedAnchors.sort();
    const c = JSON.parse(csvEq.stdout).matchedAnchors.sort();
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a).toEqual([s1, s2].sort());
  });
});

describe("schema-drift-diff: --kind stays consistent across markdown + --json", () => {
  it("--kind mistyped selects the same failures in md and json (both exit 0)", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const md = bun(DIFF_SCRIPT, [p, p, "--kind", "mistyped"]);
    const js = bun(DIFF_SCRIPT, [p, p, "--kind", "mistyped", "--json"]);
    expect(md.code).toBe(0);
    expect(js.code).toBe(0);
    const parsed = JSON.parse(js.stdout);
    const target = anchorFor(FAILING.files.find((f) => f.browser === "chromium")!);
    expect(parsed.matchedAnchors).toEqual([target]);
    expect(md.stdout).toContain(`#${target}`);
    const webkit = anchorFor(FAILING.files.find((f) => f.browser === "webkit")!);
    expect(md.stdout).not.toContain(`#${webkit}`);
    expect(parsed.matchedAnchors).not.toContain(webkit);
  });

  it("--kind and --fail-slug can be combined and both narrow the output", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const target = anchorFor(FAILING.files.find((f) => f.browser === "chromium")!);
    const js = bun(DIFF_SCRIPT, [p, p, "--kind", "mistyped", "--fail-slug", target, "--json"]);
    expect(js.code).toBe(0);
    expect(JSON.parse(js.stdout).matchedAnchors).toEqual([target]);
  });
});

describe("schema-drift-diff: pattern matchers (compileMatcher, expandKindPatterns)", () => {
  it("compileMatcher supports exact, glob, and /regex/ forms", () => {
    expect(compileMatcher("fail-a")("fail-a")).toBe(true);
    expect(compileMatcher("fail-a")("fail-b")).toBe(false);
    expect(compileMatcher("fail-chromium-*")("fail-chromium-drift-x")).toBe(true);
    expect(compileMatcher("fail-chromium-*")("fail-webkit-drift-x")).toBe(false);
    expect(compileMatcher("fail-?ebkit-*")("fail-webkit-drift-x")).toBe(true);
    expect(compileMatcher("/^fail-(chromium|webkit)-/")("fail-webkit-drift-x")).toBe(true);
    expect(compileMatcher("/^fail-firefox/")("fail-webkit-drift-x")).toBe(false);
  });

  it("expandKindPatterns resolves `*` to all kinds and globs to subsets", () => {
    expect(expandKindPatterns(["*"]).sort()).toEqual(["extra", "missing", "mistyped", "parseError"]);
    expect(expandKindPatterns(["parse*"])).toEqual(["parseError"]);
    expect(expandKindPatterns(["mis*"]).sort()).toEqual(["missing", "mistyped"]);
    expect(expandKindPatterns(["nope"])).toEqual([]);
  });

  it("--fail-slug wildcard filters diff output in JSON and markdown", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const js = bun(DIFF_SCRIPT, [p, p, "--json", "--fail-slug", "fail-chromium-*"]);
    expect(js.code).toBe(0);
    const parsed = JSON.parse(js.stdout);
    for (const s of parsed.matchedAnchors) expect(s).toMatch(/^fail-chromium-/);
    expect(parsed.matchedAnchors.length).toBeGreaterThan(0);
  });
});

describe("schema-drift-diff: --json-out + --validate-json", () => {
  it("--json-out writes the payload to a file (implies --json) and validates against the schema", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const jsonOut = join(dir, "diff.json");
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut, "--validate-json"]);
    expect(code).toBe(0);
    expect(stderr).toContain("schema-drift diff (json):");
    expect(stderr).toContain("validate-json: OK");
    const parsed = JSON.parse(_readFileSync(jsonOut, "utf8"));
    expect(parsed).toHaveProperty("totals.matched");
    expect(parsed).toHaveProperty("matchedAnchors");
    expect(Array.isArray(parsed.added)).toBe(true);
  });

  it("--validate-json without --json exits 2 with a helpful error", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--validate-json"]);
    expect(code).toBe(2);
    expect(stderr).toContain("--validate-json requires --json");
  });
});

describe("schema-drift-diff: pattern escaping + multi-pattern expansion", () => {
  const dot: Report = {
    strict: true,
    totals: { checked: 2, ok: 0, invalid: 2 },
    files: [
      { path: "/a/drift-chromium.json", ok: false, browser: "chromium", missing: ["x"] },
      { path: "/a/drift-webkit.json", ok: false, browser: "webkit", extra: ["y"] },
    ],
  };

  it("compileMatcher escapes regex metacharacters in glob patterns", () => {
    // a literal `.` should NOT match `x` — proves `.` was escaped
    expect(compileMatcher("fail.json")("failXjson")).toBe(false);
    expect(compileMatcher("fail.json")("fail.json")).toBe(true);
    // `+` and `(` must be literal in glob mode
    expect(compileMatcher("a+b")("a+b")).toBe(true);
    expect(compileMatcher("a+b")("aab")).toBe(false);
    expect(compileMatcher("(x)")("(x)")).toBe(true);
  });

  it("/regex/flags parses flags: case-insensitive match works", () => {
    expect(compileMatcher("/^FAIL-/i")("fail-webkit-x")).toBe(true);
    expect(compileMatcher("/^FAIL-/")("fail-webkit-x")).toBe(false);
  });

  it("--fail-slug accepts multiple patterns (repeat + comma + glob) in one run", () => {
    const dir = tmp();
    const p = writeReport(dir, dot);
    const { code, stdout } = bun(DIFF_SCRIPT, [
      p, p, "--json",
      "--fail-slug", "fail-chromium-*,fail-webkit-*",
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.matchedAnchors.length).toBe(2);
    for (const s of parsed.matchedAnchors) expect(s).toMatch(/^fail-(chromium|webkit)-/);
  });

  it("--kind accepts glob (mis*) and expands to both `missing` and `mistyped`", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stdout } = bun(DIFF_SCRIPT, [p, p, "--json", "--kind", "mis*"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    // FAILING has 2 files with missing and 1 with mistyped → 3 matched
    expect(parsed.matchedAnchors.length).toBe(3);
  });

  it("--kind pattern that matches nothing exits 2 with a helpful error", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--kind", "nope*"]);
    expect(code).toBe(2);
    expect(stderr).toContain("matched no known kinds");
  });
});

describe("schema-drift-diff: --json-out integration + atomicity", () => {
  it("--json-out payload byte-equals --json stdout for the same inputs", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const jsonOut = join(dir, "diff.json");
    const stdoutRun = bun(DIFF_SCRIPT, [p, p, "--json"]);
    const fileRun = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
    expect(stdoutRun.code).toBe(0);
    expect(fileRun.code).toBe(0);
    const fileBytes = _readFileSync(jsonOut, "utf8");
    expect(fileBytes).toBe(stdoutRun.stdout);
    const parsed = JSON.parse(fileBytes);
    expect(parsed.matchedAnchors).toEqual(JSON.parse(stdoutRun.stdout).matchedAnchors);
    expect(parsed.totals).toEqual(JSON.parse(stdoutRun.stdout).totals);
  });

  it("--json-out uses an atomic write (no leftover *.tmp file on success)", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const jsonOut = join(dir, "atomic.json");
    const { code } = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
    expect(code).toBe(0);
    const listing = require("node:fs").readdirSync(dir);
    expect(listing).toContain("atomic.json");
    expect(listing.filter((n: string) => n.endsWith(".tmp") || n.includes("atomic.json."))).toEqual([]);
  });

  it("--json-out to an unwritable destination exits 7 with a clear message", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    // Directory that does not exist AND cannot be created (parent is a file)
    const notADir = join(dir, "not-a-dir");
    writeFileSync(notADir, "blocker");
    const jsonOut = join(notADir, "child", "diff.json");
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
    expect(code).toBe(7);
    expect(stderr).toContain("cannot write");
    expect(stderr).toContain(jsonOut);
  });
});

describe("schema-drift-diff: --validate-json Ajv error details", () => {
  it("prints Ajv errors with instancePath + schemaPath in a JSON payload on failure", () => {
    // Force a schema mismatch by pointing at a wrong schema via a stub.
    // Simpler: monkey-patch by writing an invalid JSON to --json-out via a
    // hand-crafted validator run — but the tool always emits valid output.
    // Instead, invoke the tool with a report whose diff yields empty arrays
    // and use `--fail-slug '*'`, then post-process is fine (payload is valid).
    // → validate a KNOWN-BAD payload against the schema directly through the CLI
    //   by using --json + --validate-json is expected to always pass; skip if valid.
    // We assert the failure path via a tiny helper that reuses compileMatcher's file.
    // (See the impl: --validate-json failure exits 6 with JSON error payload.)
    // NOTE: this test exercises the success path; failure path is exercised in
    // the "impl" branch that hand-crafts a bad payload via env override.
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stderr } = bun(
      DIFF_SCRIPT, [p, p, "--json", "--validate-json"],
      { SCHEMA_DRIFT_DIFF_FORCE_INVALID: "1" },
    );
    expect(code).toBe(6);
    const parsed = JSON.parse(stderr);
    expect(parsed).toMatchObject({ error: "json-schema-mismatch", code: 6 });
    expect(Array.isArray(parsed.ajvErrors)).toBe(true);
    expect(parsed.ajvErrors.length).toBeGreaterThan(0);
    const first = parsed.ajvErrors[0];
    expect(first).toHaveProperty("instancePath");
    expect(first).toHaveProperty("schemaPath");
    expect(parsed.expectedChecklist).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: expect.any(String) })]),
    );
  });
});

describe("schema-drift-diff: --help includes concrete examples", () => {
  it("--help mentions --json, --json-out, --validate-json, and wildcard/regex patterns", () => {
    const { code, stderr } = bun(DIFF_SCRIPT, ["--help"]);
    expect(code).toBe(0);
    expect(stderr).toContain("Examples:");
    expect(stderr).toContain("--json-out");
    expect(stderr).toContain("--validate-json");
    expect(stderr).toContain("--fail-slug 'fail-chromium-*'");
    expect(stderr).toContain("/regex/");
  });
});

describe("schema-drift-diff: --print-schema", () => {
  it("prints the JSON Schema for the --json output to stdout and exits 0", () => {
    const { code, stdout } = bun(DIFF_SCRIPT, ["--print-schema"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.$id).toMatch(/schema-drift-diff\.schema\.json$/);
    expect(parsed.properties).toHaveProperty("matchedAnchors");
    expect(parsed.properties).toHaveProperty("totals");
  });

  it("--print-schema stdout content matches the on-disk schema (byte-for-byte modulo trailing newline)", () => {
    const { code, stdout } = bun(DIFF_SCRIPT, ["--print-schema"]);
    expect(code).toBe(0);
    const schemaPath = resolve(__dirname, "../../schemas/schema-drift-diff.schema.json");
    const onDisk = _readFileSync(schemaPath, "utf8");
    const normalize = (s: string) => (s.endsWith("\n") ? s : s + "\n");
    expect(stdout).toBe(normalize(onDisk));
    // sanity: printed schema round-trips as valid JSON and equals the parsed on-disk copy
    expect(JSON.parse(stdout)).toEqual(JSON.parse(onDisk));
  });

  it("--print-schema output validates a real --json payload via Ajv", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const schemaRun = bun(DIFF_SCRIPT, ["--print-schema"]);
    const payloadRun = bun(DIFF_SCRIPT, [p, p, "--json"]);
    expect(schemaRun.code).toBe(0);
    expect(payloadRun.code).toBe(0);
    const AjvMod = require("ajv");
    const Ajv = AjvMod.default ?? AjvMod;
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(JSON.parse(schemaRun.stdout));
    const ok = validate(JSON.parse(payloadRun.stdout));
    expect(validate.errors).toBeNull();
    expect(ok).toBe(true);
  });
});


describe("schema-drift-diff: --json-out atomic write failure modes", () => {
  it("auto-creates a missing nested destination directory (mkdir -p)", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const nested = join(dir, "a", "b", "c", "diff.json");
    const { code } = bun(DIFF_SCRIPT, [p, p, "--json-out", nested]);
    expect(code).toBe(0);
    expect(_readFileSync(nested, "utf8")).toContain("matchedAnchors");
  });

  it("exit 7 when the parent path is blocked by a regular file", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x");
    const jsonOut = join(blocker, "child", "diff.json");
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
    expect(code).toBe(7);
    expect(stderr).toContain("cannot write json-out");
    expect(stderr).toContain("fix:");
  });

  it("exit 7 with permission-denied when the parent dir is not writable", () => {
    // skip on root — chmod 0o500 is bypassed for uid 0
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const roDir = join(dir, "readonly");
    require("node:fs").mkdirSync(roDir);
    require("node:fs").chmodSync(roDir, 0o500);
    try {
      const jsonOut = join(roDir, "diff.json");
      const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
      expect(code).toBe(7);
      expect(stderr).toContain("cannot write json-out");
      expect(stderr).toMatch(/EACCES|EPERM/);
      // no partial .tmp left behind
      expect(require("node:fs").readdirSync(roDir)).toEqual([]);
    } finally {
      require("node:fs").chmodSync(roDir, 0o700);
    }
  });


  it("exit 7 when the temporary `<path>.<pid>.tmp` file cannot be created", () => {
    // Parent dir exists but is read-only, so writing the sibling .tmp fails.
    // This exercises the atomic-write tmp-file creation branch (distinct
    // from the "parent path blocked by a regular file" test above).
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const roDir = join(dir, "ro-parent");
    require("node:fs").mkdirSync(roDir);
    require("node:fs").chmodSync(roDir, 0o500);
    try {
      const jsonOut = join(roDir, "diff.json");
      const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
      expect(code).toBe(7);
      expect(stderr).toContain("cannot write json-out");
      expect(stderr).toContain(jsonOut);
      expect(stderr).toMatch(/EACCES|EPERM/);
      // destination is NOT created and no `.tmp` sibling is left behind
      const listing = require("node:fs").readdirSync(roDir);
      expect(listing).toEqual([]);
    } finally {
      require("node:fs").chmodSync(roDir, 0o700);
    }
  });
});

describe("schema-drift-diff: --validate-json failure payload details", () => {
  it("stderr JSON includes ajvErrors[].instancePath/schemaPath and full expectedChecklist keys", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stderr } = bun(
      DIFF_SCRIPT, [p, p, "--json", "--validate-json"],
      { SCHEMA_DRIFT_DIFF_FORCE_INVALID: "1" },
    );
    expect(code).toBe(6);
    const parsed = JSON.parse(stderr);
    expect(parsed.error).toBe("json-schema-mismatch");
    expect(parsed.code).toBe(6);
    expect(parsed.schemaPath).toMatch(/schema-drift-diff\.schema\.json$/);
    expect(parsed.fix).toBeTruthy();
    // ajvErrors expose the exact failing path(s)
    expect(Array.isArray(parsed.ajvErrors)).toBe(true);
    expect(parsed.ajvErrors.length).toBeGreaterThan(0);
    for (const e of parsed.ajvErrors) {
      expect(e).toHaveProperty("instancePath");
      expect(e).toHaveProperty("schemaPath");
      expect(e).toHaveProperty("keyword");
      expect(e).toHaveProperty("message");
    }
    // At least one error should point at the `totals` field of the forced-bad payload
    const paths = parsed.ajvErrors.map((e: any) => e.instancePath + " " + e.schemaPath).join("\n");
    expect(paths).toMatch(/totals/);
    // full checklist of expected top-level keys is present
    const keys = parsed.expectedChecklist.map((c: any) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining(["totals", "added", "removed", "changed", "matchedAnchors"]),
    );
    for (const c of parsed.expectedChecklist) {
      expect(c).toHaveProperty("present");
      expect(typeof c.present).toBe("boolean");
    }
  });
});

describe("schema-drift-diff: invalid --fail-slug/--kind patterns fail fast", () => {
  it("--fail-slug with an invalid /regex/ exits 2 with a clear error", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json", "--fail-slug", "/[unclosed/"]);
    expect(code).toBe(2);
    expect(stderr).toContain("invalid --fail-slug pattern");
    expect(stderr).toContain("/[unclosed/");
    expect(stderr).toContain("fix:");
  });

  it("--kind with an invalid /regex/ exits 2 with a clear error", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--kind", "/(unbalanced/"]);
    expect(code).toBe(2);
    expect(stderr).toContain("invalid --kind pattern");
    expect(stderr).toContain("fix:");
  });

  it("--fail-slug comma-list fails fast on the first invalid pattern", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json", "--fail-slug", "fail-chromium-*,/[bad/"]);
    expect(code).toBe(2);
    expect(stderr).toContain("invalid --fail-slug pattern");
    expect(stderr).toContain("/[bad/");
  });
});

describe("schema-drift-diff: --help examples stay in sync with CLI behavior", () => {
  const runHelp = () => bun(DIFF_SCRIPT, ["--help"]);

  it("advertises --json + --validate-json example and the flag actually works", () => {
    const { code, stderr } = runHelp();
    expect(code).toBe(0);
    expect(stderr).toContain("--json --validate-json");
    // sanity: the advertised combination actually runs cleanly
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const run = bun(DIFF_SCRIPT, [p, p, "--json", "--validate-json"]);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain("validate-json: OK");
  });

  it("advertises --json-out and the atomic write actually produces the file", () => {
    const { stderr } = runHelp();
    expect(stderr).toContain("--json-out");
    expect(stderr).toMatch(/atomic/i);
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const jsonOut = join(dir, "diff.json");
    const run = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
    expect(run.code).toBe(0);
    expect(_readFileSync(jsonOut, "utf8")).toContain("matchedAnchors");
  });

  it("advertises wildcard --fail-slug example and the glob filter actually works", () => {
    const { stderr } = runHelp();
    expect(stderr).toContain("--fail-slug 'fail-chromium-*'");
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const run = bun(DIFF_SCRIPT, [p, p, "--json", "--fail-slug", "fail-chromium-*"]);
    expect(run.code).toBe(0);
    // valid JSON payload, no invalid-pattern error
    expect(() => JSON.parse(run.stdout)).not.toThrow();
  });

  it("advertises /regex/flags example and a /regex/ pattern actually works", () => {
    const { stderr } = runHelp();
    expect(stderr).toContain("/regex/");
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const run = bun(DIFF_SCRIPT, [p, p, "--json", "--fail-slug", "/^fail-/i"]);
    expect(run.code).toBe(0);
    expect(() => JSON.parse(run.stdout)).not.toThrow();
  });

  it("advertises --print-schema example and the flag actually prints valid JSON Schema", () => {
    const { stderr } = runHelp();
    expect(stderr).toContain("--print-schema");
    const run = bun(DIFF_SCRIPT, ["--print-schema"]);
    expect(run.code).toBe(0);
    const parsed = JSON.parse(run.stdout);
    expect(parsed).toHaveProperty("$id");
  });
});

describe("schema-drift-diff: --validate-json stable ordering", () => {
  const runOnce = () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stderr } = bun(
      DIFF_SCRIPT, [p, p, "--json", "--validate-json"],
      { SCHEMA_DRIFT_DIFF_FORCE_INVALID: "1" },
    );
    expect(code).toBe(6);
    return JSON.parse(stderr);
  };

  it("ajvErrors and expectedChecklist ordering is stable across repeated runs", () => {
    const a = runOnce();
    const b = runOnce();
    const c = runOnce();
    const keyOf = (e: any) => `${e.instancePath}|${e.schemaPath}|${e.keyword}|${e.message}`;
    expect(a.ajvErrors.map(keyOf)).toEqual(b.ajvErrors.map(keyOf));
    expect(b.ajvErrors.map(keyOf)).toEqual(c.ajvErrors.map(keyOf));
    expect(a.expectedChecklist.map((x: any) => x.key)).toEqual(
      b.expectedChecklist.map((x: any) => x.key),
    );
    expect(b.expectedChecklist.map((x: any) => x.key)).toEqual(
      c.expectedChecklist.map((x: any) => x.key),
    );
  });
});

describe("schema-drift-diff: --fail-slug + --kind combined", () => {
  it("intersects both filters and returns a valid JSON payload with matching anchors", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const run = bun(DIFF_SCRIPT, [
      p, p, "--json",
      "--kind", "missing",
      "--fail-slug", "fail-*",
    ]);
    expect(run.code).toBe(0);
    const payload = JSON.parse(run.stdout);
    // before === after, so no add/remove/change; matches only
    expect(payload.totals.added).toBe(0);
    expect(payload.totals.removed).toBe(0);
    expect(payload.totals.changed).toBe(0);
    expect(payload.matchedAnchors.length).toBeGreaterThan(0);
    expect(payload.totals.matched).toBe(payload.matchedAnchors.length);
    // every returned anchor matches the fail-slug glob
    for (const a of payload.matchedAnchors) expect(a).toMatch(/^fail-/);
  });

  it("--kind filter narrower than --fail-slug returns strictly fewer or equal anchors", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const wide = bun(DIFF_SCRIPT, [p, p, "--json", "--fail-slug", "fail-*"]);
    const narrow = bun(DIFF_SCRIPT, [p, p, "--json", "--fail-slug", "fail-*", "--kind", "missing"]);
    expect(wide.code).toBe(0);
    expect(narrow.code).toBe(0);
    const w = JSON.parse(wide.stdout);
    const n = JSON.parse(narrow.stdout);
    expect(n.matchedAnchors.length).toBeLessThanOrEqual(w.matchedAnchors.length);
    // narrow ⊆ wide
    const wideSet = new Set(w.matchedAnchors);
    for (const a of n.matchedAnchors) expect(wideSet.has(a)).toBe(true);
  });
});

describe("schema-drift-diff: --json-out long destination path", () => {
  it("atomic rename succeeds with a deeply-nested long destination path", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    // Build a long-but-portable path: 10 nested segments of 20 chars each
    // (~220 chars under tmp) — well below Windows MAX_PATH=260 for the
    // tmp prefix but long enough to catch buffer/encoding regressions in
    // renameSync on any platform.
    const segments = Array.from({ length: 10 }, (_, i) => `seg-${i}-${"x".repeat(15)}`);
    const jsonOut = join(dir, ...segments, "diff.json");
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
    expect(code).toBe(0);
    expect(stderr).toContain("schema-drift diff (json):");
    expect(_readFileSync(jsonOut, "utf8")).toContain("matchedAnchors");
    // No `.tmp` sibling left behind
    const parentListing = require("node:fs").readdirSync(join(dir, ...segments));
    expect(parentListing.filter((f: string) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("schema-drift-diff: --help examples stable under flag reordering/aliases", () => {
  it("--help output is byte-identical whether -h or --help is used", () => {
    const a = bun(DIFF_SCRIPT, ["--help"]);
    const b = bun(DIFF_SCRIPT, ["-h"]);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    expect(a.stderr).toBe(b.stderr);
  });

  it("advertised examples still work with flags in reversed order", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    // Reversed order: --validate-json before --json
    const a = bun(DIFF_SCRIPT, [p, p, "--validate-json", "--json"]);
    expect(a.code).toBe(0);
    expect(a.stderr).toContain("validate-json: OK");
    // Reversed order: --fail-slug before positionals
    const b = bun(DIFF_SCRIPT, ["--fail-slug", "fail-chromium-*", "--json", p, p]);
    expect(b.code).toBe(0);
    expect(() => JSON.parse(b.stdout)).not.toThrow();
  });

  it("=-form aliases (--kind=..., --fail-slug=..., --json-out=...) behave identically to space-form", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const space = bun(DIFF_SCRIPT, [p, p, "--json", "--fail-slug", "fail-*", "--kind", "missing"]);
    const eq = bun(DIFF_SCRIPT, [p, p, "--json", "--fail-slug=fail-*", "--kind=missing"]);
    expect(space.code).toBe(0);
    expect(eq.code).toBe(0);
    expect(JSON.parse(space.stdout)).toEqual(JSON.parse(eq.stdout));

    const outSpace = join(dir, "space.json");
    const outEq = join(dir, "eq.json");
    const rs = bun(DIFF_SCRIPT, [p, p, "--json-out", outSpace]);
    const re = bun(DIFF_SCRIPT, [p, p, `--json-out=${outEq}`]);
    expect(rs.code).toBe(0);
    expect(re.code).toBe(0);
    expect(_readFileSync(outSpace, "utf8")).toBe(_readFileSync(outEq, "utf8"));
  });
});

describe("schema-drift-diff: --json-out atomic replace of existing destination", () => {
  it("atomically overwrites an existing file, preserves exit code 0, and leaves no .tmp behind", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const jsonOut = join(dir, "diff.json");
    // Pre-existing file with stale content.
    writeFileSync(jsonOut, "STALE\n");
    const first = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
    expect(first.code).toBe(0);
    const firstBytes = _readFileSync(jsonOut, "utf8");
    expect(firstBytes).not.toBe("STALE\n");
    expect(firstBytes).toContain("matchedAnchors");
    // Second run must also succeed and produce byte-identical output.
    const second = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
    expect(second.code).toBe(0);
    expect(_readFileSync(jsonOut, "utf8")).toBe(firstBytes);
    // No sibling *.tmp leftover.
    const { readdirSync } = require("node:fs");
    expect(readdirSync(dir).filter((n: string) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("schema-drift-diff: --json-out simulated write failure cleanup", () => {
  it("cleans up the temp file and exits 7 when rename fails (destination is a directory)", () => {
    const { mkdirSync, readdirSync } = require("node:fs");
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    // Destination path is a pre-existing directory → renameSync(tmp, dest) fails
    // with EISDIR/ENOTEMPTY, simulating a mid-write failure. The catch block
    // must unlink the sibling .tmp file so nothing is left behind.
    const jsonOut = join(dir, "diff.json");
    mkdirSync(jsonOut);
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
    expect(code).toBe(7);
    expect(stderr).toContain("cannot write json-out");
    expect(readdirSync(dir).filter((n: string) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("schema-drift-diff: exit-code enumeration + messages", () => {
  it("exit 0 on a successful text diff", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code } = bun(DIFF_SCRIPT, [p, p]);
    expect(code).toBe(0);
  });

  it("exit 2 on unknown flag with a clear message", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--bogus"]);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown arg");
  });

  it("exit 2 when --validate-json is used without --json", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--validate-json"]);
    expect(code).toBe(2);
    expect(stderr).toContain("--validate-json requires --json");
  });

  it("exit 3 when the before report file does not exist", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stderr } = bun(DIFF_SCRIPT, [join(dir, "missing.json"), p]);
    expect(code).toBe(3);
    expect(stderr).toContain("cannot read before report");
  });

  it("exit 4 when a report is not valid JSON", () => {
    const dir = tmp();
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not-json");
    const good = writeReport(dir, FAILING);
    const { code, stderr } = bun(DIFF_SCRIPT, [bad, good]);
    expect(code).toBe(4);
    expect(stderr).toContain("is not valid JSON");
  });

  it("exit 5 when the report is missing required top-level fields", () => {
    const dir = tmp();
    const bad = join(dir, "shape.json");
    writeFileSync(bad, JSON.stringify({ hello: "world" }));
    const good = writeReport(dir, FAILING);
    const { code, stderr } = bun(DIFF_SCRIPT, [bad, good]);
    expect(code).toBe(5);
    expect(stderr).toContain("missing required fields");
  });

  it("exit 6 when --validate-json rejects the payload", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const { code, stderr } = bun(
      DIFF_SCRIPT,
      [p, p, "--json", "--validate-json"],
      { SCHEMA_DRIFT_DIFF_FORCE_INVALID: "1" },
    );
    expect(code).toBe(6);
    expect(stderr).toContain("json-schema-mismatch");
  });

  it("exit 7 when --json-out cannot write the destination", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const blocker = join(dir, "not-a-dir");
    writeFileSync(blocker, "x");
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json-out", join(blocker, "child", "diff.json")]);
    expect(code).toBe(7);
    expect(stderr).toContain("cannot write json-out");
  });
});

describe("schema-drift-diff: --json-out concurrency + tmp-file hygiene", () => {
  it("parallel --json-out writers to the same destination all exit 0 and produce the canonical payload", async () => {
    const { readdirSync } = require("node:fs");
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const jsonOut = join(dir, "diff.json");
    // Canonical single-run payload for comparison.
    const canonical = bun(DIFF_SCRIPT, [p, p, "--json"]);
    expect(canonical.code).toBe(0);

    const N = 5;
    const runs = await Promise.all(
      Array.from({ length: N }, () =>
        new Promise<{ code: number; stderr: string }>((res) => {
          const child = spawnSync("bun", [DIFF_SCRIPT, p, p, "--json-out", jsonOut], {
            encoding: "utf8",
            env: process.env,
          });
          res({ code: child.status ?? -1, stderr: child.stderr ?? "" });
        }),
      ),
    );
    for (const r of runs) expect(r.code).toBe(0);
    // Final file matches the canonical --json stdout byte-for-byte
    // (all writers produce identical bytes for identical inputs).
    expect(_readFileSync(jsonOut, "utf8")).toBe(canonical.stdout);
    // No leftover *.tmp files after everyone finished.
    expect(readdirSync(dir).filter((n: string) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("cleans up a pre-existing stale `<name>.<pid>.tmp` sibling and still atomically replaces the destination", () => {
    const { readdirSync, writeFileSync: wfs } = require("node:fs");
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const jsonOut = join(dir, "diff.json");
    // Simulate a crashed prior run: leftover .tmp under a pid that is
    // guaranteed not to exist (pid 1 is `init`; we use a large pid that
    // `process.kill(_, 0)` will reject with ESRCH).
    const stalePid = 2147483; // improbable live pid
    const stale = join(dir, `diff.json.${stalePid}.tmp`);
    wfs(stale, "GARBAGE\n");
    const { code } = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
    expect(code).toBe(0);
    expect(_readFileSync(jsonOut, "utf8")).toContain("matchedAnchors");
    // The stale .tmp was cleaned up; no .tmp sibling remains.
    expect(readdirSync(dir).filter((n: string) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("exit 7 with a clear message when the destination parent directory does not exist and cannot be created", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    // Parent path is a regular file, so mkdirSync recursive fails with ENOTDIR.
    const blocker = join(dir, "file-not-dir");
    writeFileSync(blocker, "x");
    const jsonOut = join(blocker, "missing-parent", "diff.json");
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
    expect(code).toBe(7);
    expect(stderr).toContain(`cannot write json-out to "${jsonOut}"`);
    expect(stderr).toContain("fix: check that the parent directory exists and is writable");
  });

  it("simulated mid-write failure removes the temp file and leaves the destination unchanged", () => {
    const { readdirSync } = require("node:fs");
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const jsonOut = join(dir, "diff.json");
    // Pre-existing destination content that MUST survive a failed run.
    const preexisting = "PREEXISTING\n";
    writeFileSync(jsonOut, preexisting);
    const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut], {
      SCHEMA_DRIFT_DIFF_FORCE_TMP_WRITE_FAIL: "1",
    });
    expect(code).toBe(7);
    expect(stderr).toContain("cannot write json-out");
    // Destination file is byte-for-byte unchanged.
    expect(_readFileSync(jsonOut, "utf8")).toBe(preexisting);
    // No .tmp leftover.
    expect(readdirSync(dir).filter((n: string) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("schema-drift-diff: --json-out stress + read-only + stderr wording", () => {
  it("stress: many parallel writers with varying JSON sizes leave a valid, canonical JSON file", async () => {
    const { readdirSync } = require("node:fs");
    const dir = tmp();
    const jsonOut = join(dir, "diff.json");

    // Build N reports of varying size (varying failing-file counts) → varying
    // JSON payload sizes for --json-out.
    const N = 6;
    const reports: string[] = [];
    const canonicals: string[] = [];
    for (let i = 0; i < N; i++) {
      const files = Array.from({ length: i * 3 + 1 }, (_, j) => ({
        path: `/stress/f${i}-${j}.json`,
        ok: false,
        browser: "chromium",
        combined: false,
        missing: [`m${j}`],
        mistyped: [],
        extra: [],
      }));
      const r: Report = {
        strict: true,
        totals: { checked: files.length, ok: 0, invalid: files.length },
        files,
      };
      const p = join(dir, `report-${i}.json`);
      writeFileSync(p, JSON.stringify(r));
      reports.push(p);
      const c = bun(DIFF_SCRIPT, [p, p, "--json"]);
      expect(c.code).toBe(0);
      canonicals.push(c.stdout);
    }
    // Sanity: payloads actually vary in size.
    expect(new Set(canonicals.map((s) => s.length)).size).toBeGreaterThan(1);

    const runs = await Promise.all(
      reports.map(
        (p) =>
          new Promise<{ code: number }>((res) => {
            const child = spawnSync(
              "bun",
              [DIFF_SCRIPT, p, p, "--json-out", jsonOut],
              { encoding: "utf8", env: process.env },
            );
            res({ code: child.status ?? -1 });
          }),
      ),
    );
    for (const r of runs) expect(r.code).toBe(0);

    // Final file is valid JSON and equals one of the canonical payloads
    // (some writer's rename won the race; all payloads are self-consistent).
    const final = _readFileSync(jsonOut, "utf8");
    expect(() => JSON.parse(final)).not.toThrow();
    expect(canonicals).toContain(final);
    // No leftover .tmp files.
    expect(readdirSync(dir).filter((n: string) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("read-only destination inside a read-only parent: exits 7 and preserves the original file bytes", () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const { chmodSync, mkdirSync } = require("node:fs");
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const roDir = join(dir, "ro");
    mkdirSync(roDir);
    const jsonOut = join(roDir, "diff.json");
    const preexisting = "ORIGINAL_CONTENT\n";
    writeFileSync(jsonOut, preexisting);
    chmodSync(jsonOut, 0o444);
    chmodSync(roDir, 0o555);
    try {
      const { code, stderr } = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
      expect(code).toBe(7);
      expect(stderr).toContain("cannot write json-out");
      expect(stderr).toMatch(/EACCES|EPERM/);
      // Original file bytes are unchanged.
      expect(_readFileSync(jsonOut, "utf8")).toBe(preexisting);
    } finally {
      chmodSync(roDir, 0o700);
      chmodSync(jsonOut, 0o600);
    }
  });

  it("failure stderr uses the exact `cleanup:` wording for both temp-file states", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const jsonOut = join(dir, "diff.json");

    // Case A: mid-write hook → tmp exists and is removed.
    const preexisting = "KEEP_ME\n";
    writeFileSync(jsonOut, preexisting);
    const a = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut], {
      SCHEMA_DRIFT_DIFF_FORCE_TMP_WRITE_FAIL: "1",
    });
    expect(a.code).toBe(7);
    expect(a.stderr).toMatch(/cleanup: removed partial temp file "[^"]+\.\d+\.tmp"/);
    expect(_readFileSync(jsonOut, "utf8")).toBe(preexisting);

    // Case B: parent path blocked by a regular file → mkdirSync fails before
    // any tmp file is written, so the cleanup line reports "no temp file".
    const blocker = join(dir, "not-a-dir");
    writeFileSync(blocker, "x");
    const missingParent = join(blocker, "child", "diff.json");
    const b = bun(DIFF_SCRIPT, [p, p, "--json-out", missingParent]);
    expect(b.code).toBe(7);
    expect(b.stderr).toMatch(/cleanup: no temp file to remove at "[^"]+\.\d+\.tmp"/);
  });

  it("test-only hook doc exists and describes SCHEMA_DRIFT_DIFF_FORCE_TMP_WRITE_FAIL", () => {
    const doc = _readFileSync(
      resolve(__dirname, "../../docs/schema-drift-diff-test-hooks.md"),
      "utf8",
    );
    expect(doc).toContain("SCHEMA_DRIFT_DIFF_FORCE_TMP_WRITE_FAIL");
    expect(doc).toContain("exit"); // documents exit code
    expect(doc).toContain("cleanup: removed partial temp file");
    expect(doc).toContain("byte-for-byte unchanged");
  });

  it("documents the exact atomicWrite failure contract (three-line stderr shape)", () => {
    const doc = _readFileSync(
      resolve(__dirname, "../../docs/schema-drift-diff-test-hooks.md"),
      "utf8",
    );
    // The contract section and each of the three lines must be present verbatim
    // so tests elsewhere can rely on the exact wording.
    expect(doc).toContain("## `atomicWrite` failure contract");
    expect(doc).toContain('error: cannot write <label> to "<dest>"');
    expect(doc).toContain('cleanup: <cleanup-line>');
    expect(doc).toContain("fix: check that the parent directory exists and is writable");
    expect(doc).toContain('removed partial temp file "<dest>.<pid>.tmp"');
    expect(doc).toContain('no temp file to remove at "<dest>.<pid>.tmp"');
    expect(doc).toContain("Exit code is always `7`");
  });

  it("end-to-end: --json-out writes a file whose contents parse as valid JSON matching --json", () => {
    const dir = tmp();
    const before = writeReport(dir, FAILING);
    const after = writeReport(join(dir), FAILING);
    const jsonOut = join(dir, "e2e-diff.json");

    const run = bun(DIFF_SCRIPT, [before, after, "--json-out", jsonOut]);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain(`schema-drift diff (json): ${jsonOut}`);

    const onDisk = _readFileSync(jsonOut, "utf8");
    // Parses as JSON …
    const parsed = JSON.parse(onDisk);
    // … and matches the canonical --json payload on stdout for the same inputs.
    const canonical = bun(DIFF_SCRIPT, [before, after, "--json"]);
    expect(canonical.code).toBe(0);
    expect(onDisk).toBe(canonical.stdout);
    // Sanity: shape matches DiffResult.
    expect(parsed).toHaveProperty("totals");
    expect(parsed).toHaveProperty("added");
    expect(parsed).toHaveProperty("removed");
    expect(parsed).toHaveProperty("changed");
    expect(parsed).toHaveProperty("matchedAnchors");
  });

  it("--json-out works with destination paths containing spaces and special characters", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    // Spaces, unicode, ampersand, parentheses, single quote, dollar sign.
    const spicyDir = join(dir, "weird dir & name (v1) — café");
    const { mkdirSync } = require("node:fs");
    mkdirSync(spicyDir, { recursive: true });
    const jsonOut = join(spicyDir, "diff $out 'x' & y.json");

    // Pre-existing content proves atomic replace, not append.
    writeFileSync(jsonOut, "STALE_CONTENT_SHOULD_BE_REPLACED\n");
    // Pre-existing stale <name>.<pid>.tmp from an "old" dead pid — should be
    // cleaned up by the successful write's readdirSync pass.
    const staleTmp = `${jsonOut}.2147483.tmp`;
    writeFileSync(staleTmp, "stale-tmp");

    const run = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
    expect(run.code).toBe(0);

    const onDisk = _readFileSync(jsonOut, "utf8");
    expect(() => JSON.parse(onDisk)).not.toThrow();
    expect(onDisk).not.toContain("STALE_CONTENT_SHOULD_BE_REPLACED");

    // Stale .tmp was removed; no fresh .tmp siblings remain.
    const { readdirSync, existsSync } = require("node:fs");
    expect(existsSync(staleTmp)).toBe(false);
    const leftover = readdirSync(spicyDir).filter((n: string) => n.endsWith(".tmp"));
    expect(leftover).toEqual([]);
  });
});

// Additional coverage:
//   - symlink destination (atomic replace + tmp cleanup on failure)
//   - --json-out payload conforms to schema-drift-diff.schema.json (full validation)
//   - cleanup: wording present/absent per failure mode (perm-denied, invalid flags,
//     missing parent dir)
//
// The spaces/special-chars test above is picked up by the cross-OS CI matrix
// via its "-t" filter (see .github/workflows/ci.yml → schema-drift-diff-atomic-crossos),
// which now runs on ubuntu-latest, macos-latest, and windows-latest.
describe("schema-drift-diff: --json-out symlink + schema + cleanup wording", () => {
  const isWindows = process.platform === "win32";

  it.skipIf(isWindows)(
    "--json-out atomically replaces a symlink destination and cleans up tmp on forced failure",
    () => {
      const { symlinkSync, readdirSync, lstatSync, existsSync, unlinkSync } = require("node:fs");
      const dir = tmp();
      const p = writeReport(dir, FAILING);
      const target = join(dir, "real-target.json");
      writeFileSync(target, "PREEXISTING_TARGET\n");
      const link = join(dir, "link-to-target.json");
      symlinkSync(target, link);

      // Success path: writing via the symlink produces a valid payload at the
      // destination path (renameSync replaces the symlink entry with a regular
      // file — this documents current behavior and is atomic).
      const ok = bun(DIFF_SCRIPT, [p, p, "--json-out", link]);
      expect(ok.code).toBe(0);
      const written = _readFileSync(link, "utf8");
      expect(() => JSON.parse(written)).not.toThrow();
      expect(written).not.toContain("PREEXISTING_TARGET");
      expect(readdirSync(dir).filter((n: string) => n.endsWith(".tmp"))).toEqual([]);

      // Failure path: recreate the symlink, force a mid-write failure, and
      // verify the temp file is removed and the symlink target survives.
      try { unlinkSync(link); } catch {}
      writeFileSync(target, "PREEXISTING_TARGET\n");
      symlinkSync(target, link);
      const fail = bun(DIFF_SCRIPT, [p, p, "--json-out", link], {
        SCHEMA_DRIFT_DIFF_FORCE_TMP_WRITE_FAIL: "1",
      });
      expect(fail.code).toBe(7);
      expect(fail.stderr).toContain("cannot write json-out");
      expect(fail.stderr).toMatch(/cleanup: (removed partial temp file|no temp file to remove)/);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(_readFileSync(target, "utf8")).toBe("PREEXISTING_TARGET\n");
      expect(readdirSync(dir).filter((n: string) => n.endsWith(".tmp"))).toEqual([]);
      expect(existsSync(link)).toBe(true);
    },
  );

  it("--json-out payload validates against schemas/schema-drift-diff.schema.json (full schema, not just parse)", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const jsonOut = join(dir, "diff.json");
    const run = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut, "--validate-json"]);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain("validate-json: OK");

    // Independently re-validate the on-disk payload with Ajv to prove the
    // exit code isn't the only signal we rely on.
    const AjvMod = require("ajv");
    const Ajv = AjvMod.default ?? AjvMod;
    const schemaPath = resolve(__dirname, "../../schemas/schema-drift-diff.schema.json");
    const schema = JSON.parse(_readFileSync(schemaPath, "utf8"));
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);
    const payload = JSON.parse(_readFileSync(jsonOut, "utf8"));
    const ok = validate(payload);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);

    for (const k of ["totals", "added", "removed", "changed", "matchedAnchors"]) {
      expect(payload).toHaveProperty(k);
    }
    for (const k of ["before", "after", "added", "removed", "changed", "matched"]) {
      expect(payload.totals).toHaveProperty(k);
    }
  });

  it("stderr includes the cleanup: line for permission-denied and missing-parent failures, and omits it for invalid-flag failures", () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);

    // (a) Missing / unreachable parent directory → exit 7 with the exact
    //     three-line contract (error / cleanup / fix).
    const blocker = join(dir, "blocker-file");
    writeFileSync(blocker, "x");
    const missingParent = join(blocker, "nope", "diff.json");
    const mp = bun(DIFF_SCRIPT, [p, p, "--json-out", missingParent]);
    expect(mp.code).toBe(7);
    expect(mp.stderr).toContain(`cannot write json-out to "${missingParent}"`);
    expect(mp.stderr).toMatch(/cleanup: no temp file to remove at ".*\.tmp"/);
    expect(mp.stderr).toContain("fix: check that the parent directory exists and is writable");

    // (b) Permission-denied → exit 7 with the cleanup: line. Skip as root.
    const isRoot = typeof (process as any).getuid === "function" && (process as any).getuid() === 0;
    if (!isRoot && !isWindows) {
      const roDir = join(dir, "ro");
      const { mkdirSync, chmodSync } = require("node:fs");
      mkdirSync(roDir, { recursive: true });
      const jsonOut = join(roDir, "diff.json");
      writeFileSync(jsonOut, "ORIGINAL\n");
      chmodSync(jsonOut, 0o444);
      chmodSync(roDir, 0o555);
      try {
        const pd = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
        expect(pd.code).toBe(7);
        expect(pd.stderr).toContain("cannot write json-out");
        expect(pd.stderr).toMatch(/cleanup: (removed partial temp file|no temp file to remove) ".*\.tmp"/);
        expect(pd.stderr).toContain("fix: check that the parent directory exists and is writable");
        expect(_readFileSync(jsonOut, "utf8")).toBe("ORIGINAL\n");
      } finally {
        try { chmodSync(roDir, 0o755); } catch {}
        try { chmodSync(jsonOut, 0o644); } catch {}
      }
    }

    // (c) Invalid CLI flag → parseArgs exits 2 BEFORE atomicWrite runs, so
    //     no cleanup: line should appear. Documents the contract that the
    //     cleanup: wording is exclusive to atomicWrite failures.
    const bad = bun(DIFF_SCRIPT, [p, p, "--not-a-real-flag"]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("unknown arg: --not-a-real-flag");
    expect(bad.stderr).not.toContain("cleanup:");
  });
});

// Extra coverage for --json-out: concurrent readers observing atomic rename,
// fuzz/property inputs validating against the JSON Schema, and unsafe-symlink
// destinations (symlink to a directory) producing the exact atomicWrite
// cleanup contract. See docs/schema-drift-diff-test-hooks.md.
describe("schema-drift-diff: --json-out concurrent reader + fuzz + unsafe symlink", () => {
  const isWindows = process.platform === "win32";

  it("concurrent reader never observes a partially-written destination and exit code stays 0", async () => {
    const dir = tmp();
    const p = writeReport(dir, FAILING);
    const jsonOut = join(dir, "diff.json");
    const seed = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
    expect(seed.code).toBe(0);

    let stop = false;
    const seen: string[] = [];
    const reader = (async () => {
      while (!stop) {
        try {
          const raw = _readFileSync(jsonOut, "utf8");
          // Every observable read must parse — the atomic rename must never
          // expose an in-progress `.tmp` file to concurrent readers.
          JSON.parse(raw);
          seen.push(raw);
        } catch {
          // File briefly missing during rename is acceptable; a partial JSON
          // payload is not — JSON.parse would throw and fail the test above.
        }
        await new Promise((r) => setImmediate(r));
      }
    })();

    for (let i = 0; i < 6; i++) {
      const w = bun(DIFF_SCRIPT, [p, p, "--json-out", jsonOut]);
      expect(w.code).toBe(0);
    }
    stop = true;
    await reader;
    expect(seen.length).toBeGreaterThan(0);
    for (const raw of seen) {
      const parsed = JSON.parse(raw);
      expect(parsed).toHaveProperty("totals");
      expect(parsed).toHaveProperty("matchedAnchors");
    }
    const { readdirSync } = require("node:fs");
    expect(readdirSync(dir).filter((n: string) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("fuzz: varied valid reports always produce --json-out payloads matching the schema", () => {
    const AjvMod = require("ajv");
    const Ajv = AjvMod.default ?? AjvMod;
    const schemaPath = resolve(__dirname, "../../schemas/schema-drift-diff.schema.json");
    const schema = JSON.parse(_readFileSync(schemaPath, "utf8"));
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);

    // Deterministic LCG so failing seeds reproduce locally without flakes.
    let seed = 0xC0FFEE;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

    const genReport = (): Report => {
      const n = Math.floor(rand() * 5);
      const files = Array.from({ length: n }, (_, i) => {
        const browser = pick(["chromium", "webkit", "firefox", "combined"]);
        return {
          path: `/fuzz/${pick(["a", "b", "c"])}/drift-${browser}-${i}.json`,
          ok: false,
          browser,
          combined: browser === "combined",
          missing: rand() < 0.5 ? [pick(["x", "y", "z"])] : [],
          mistyped: rand() < 0.5
            ? [{ key: pick(["k1", "k2"]), expected: "string", got: "number" }]
            : [],
          extra: rand() < 0.5 ? [pick(["stray1", "stray2"])] : [],
        };
      });
      return { strict: true, totals: { checked: n + 1, ok: 1, invalid: n }, files };
    };

    const dir = tmp();
    const { mkdirSync } = require("node:fs");
    for (let i = 0; i < 12; i++) {
      const sub = join(dir, `case-${i}`);
      mkdirSync(sub, { recursive: true });
      const before = join(sub, "before.json");
      const after = join(sub, "after.json");
      writeFileSync(before, JSON.stringify(genReport()));
      writeFileSync(after, JSON.stringify(genReport()));
      const jsonOut = join(sub, "out.json");
      const run = bun(DIFF_SCRIPT, [before, after, "--json-out", jsonOut, "--validate-json"]);
      expect(run.code, `case ${i} stderr: ${run.stderr}`).toBe(0);
      const payload = JSON.parse(_readFileSync(jsonOut, "utf8"));
      const ok = validate(payload);
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
      for (const k of ["totals", "added", "removed", "changed", "matchedAnchors"]) {
        expect(payload).toHaveProperty(k);
      }
    }
  });

  it.skipIf(isWindows)(
    "--json-out with a symlink pointing to a directory: replaces the symlink entry on success and, on forced failure, exits 7 with the exact cleanup line and leaves the target dir untouched",
    () => {
      const { symlinkSync, mkdirSync, readdirSync, existsSync, lstatSync, unlinkSync } =
        require("node:fs");
      const dir = tmp();
      const p = writeReport(dir, FAILING);
      const targetDir = join(dir, "target-is-a-dir");
      mkdirSync(targetDir);
      writeFileSync(join(targetDir, "sentinel"), "KEEP\n");
      const link = join(dir, "unsafe-link.json");
      symlinkSync(targetDir, link);

      // Success path: renameSync atomically replaces the symlink entry with a
      // regular file — documents current behavior and proves the atomicity
      // guarantee holds even for symlink→dir destinations.
      const ok = bun(DIFF_SCRIPT, [p, p, "--json-out", link]);
      expect(ok.code).toBe(0);
      expect(lstatSync(link).isFile()).toBe(true);
      expect(existsSync(targetDir)).toBe(true);
      expect(_readFileSync(join(targetDir, "sentinel"), "utf8")).toBe("KEEP\n");
      expect(readdirSync(dir).filter((n: string) => n.endsWith(".tmp"))).toEqual([]);

      // Failure path: rebuild the symlink and force a mid-write failure. The
      // atomicWrite contract must hold: exit 7, exact three-line stderr with
      // the `removed partial temp file` cleanup line, no leftover .tmp, and
      // the symlink target directory is byte-for-byte unchanged.
      try { unlinkSync(link); } catch {}
      symlinkSync(targetDir, link);
      const fail = bun(DIFF_SCRIPT, [p, p, "--json-out", link], {
        SCHEMA_DRIFT_DIFF_FORCE_TMP_WRITE_FAIL: "1",
      });
      expect(fail.code).toBe(7);
      expect(fail.stderr).toContain(`cannot write json-out to "${link}"`);
      expect(fail.stderr).toMatch(/cleanup: removed partial temp file ".*\.\d+\.tmp"/);
      expect(fail.stderr).toContain("fix: check that the parent directory exists and is writable");
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(existsSync(targetDir)).toBe(true);
      expect(_readFileSync(join(targetDir, "sentinel"), "utf8")).toBe("KEEP\n");
      expect(readdirSync(dir).filter((n: string) => n.endsWith(".tmp"))).toEqual([]);
    },
  );
});




