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
