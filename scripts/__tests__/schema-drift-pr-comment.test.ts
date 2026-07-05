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

const PR_SCRIPT = resolve(__dirname, "../schema-drift-pr-comment.ts");
const SUM_SCRIPT = resolve(__dirname, "../schema-drift-summary.ts");

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
      .filter((l) => l.startsWith("| `/"))
      .map((l) => l.split("|")[1].trim());
    expect(rowOrder).toEqual([
      "`/a/drift-chromium.json`",
      "`/a/drift-combined.json`",
      "`/z/drift-webkit.json`",
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
