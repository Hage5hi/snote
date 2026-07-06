// Snapshot tests for the GitHub Actions log annotations emitted by
// `pretty-index-mismatch-ci-bundle-recheck` when GITHUB_ACTIONS=true.
// The Makefile prints `::error file=<path>::...` lines to stdout so the
// Actions UI renders them as red inline annotations pointing at the
// exact missing/empty file path. This file pins those stdout lines for
// every preflight case; sibling to `…-recheck-preflight.test.ts`
// (which covers the stderr wording without annotations).
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
// Use `stress` here so this file's OUT_DIR does not collide with the
// sibling `…-recheck-preflight.test.ts` file (which uses `atomic`);
// vitest runs test files in parallel and they both stage under
// `./_pi-ci-bundle-<scope>/`.
const SCOPE = "stress";
const OUT_DIR = join(REPO_ROOT, `_pi-ci-bundle-${SCOPE}`);
const EXTRACTED = join(OUT_DIR, "extracted", `pi-ci-${SCOPE}`);

const hasMake = (() => {
  try { return spawnSync("make", ["--version"]).status === 0; }
  catch { return false; }
})();

const d = hasMake ? describe : describe.skip;

function stage(files: Record<string, string | null>) {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(EXTRACTED, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    if (contents === null) continue;
    writeFileSync(join(EXTRACTED, name), contents);
  }
}

function runRecheck() {
  return spawnSync(
    "make",
    ["-s", "pretty-index-mismatch-ci-bundle-recheck", `PI_CI_SCOPE=${SCOPE}`],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, GITHUB_ACTIONS: "true" },
    },
  );
}

// Extract only the `::error file=...::...` lines so the snapshot is
// scoped strictly to the annotation contract (drops listing / re-check
// noise).
function annotations(stdout: string): string {
  return stdout
    .split("\n")
    .filter((l) => l.startsWith("::error file="))
    .join("\n");
}

d("pretty-index-mismatch-ci-bundle-recheck — GHA annotation snapshots", () => {
  beforeEach(() => rmSync(OUT_DIR, { recursive: true, force: true }));
  afterEach(() => rmSync(OUT_DIR, { recursive: true, force: true }));

  it("report MISSING → annotates the expected report path", () => {
    stage({
      "validate-report.json": null,
      "validate-schema-assertion.txt": "noop\n",
    });
    const res = runRecheck();
    expect(res.status).toBe(2);
    expect(annotations(res.stdout ?? "")).toMatchInlineSnapshot(
      `"::error file=./_pi-ci-bundle-atomic/extracted/validate-report.json::preflight: validate-report.json MISSING (expected under ./_pi-ci-bundle-atomic/extracted)"`,
    );
  });

  it("report EMPTY → annotates the exact empty report file", () => {
    stage({
      "validate-report.json": "",
      "validate-schema-assertion.txt": "noop\n",
    });
    const res = runRecheck();
    expect(res.status).toBe(2);
    expect(annotations(res.stdout ?? "")).toMatchInlineSnapshot(
      `"::error file=./_pi-ci-bundle-atomic/extracted/pi-ci-atomic/validate-report.json::preflight: validate-report.json EMPTY"`,
    );
  });

  it("assertion MISSING → annotates the expected assertion path", () => {
    stage({
      "validate-report.json": "{}\n",
      "validate-schema-assertion.txt": null,
    });
    const res = runRecheck();
    expect(res.status).toBe(2);
    expect(annotations(res.stdout ?? "")).toMatchInlineSnapshot(
      `"::error file=./_pi-ci-bundle-atomic/extracted/validate-schema-assertion.txt::preflight: validate-schema-assertion.txt MISSING (expected under ./_pi-ci-bundle-atomic/extracted)"`,
    );
  });

  it("assertion EMPTY → annotates the exact empty assertion file", () => {
    stage({
      "validate-report.json": "{}\n",
      "validate-schema-assertion.txt": "",
    });
    const res = runRecheck();
    expect(res.status).toBe(2);
    expect(annotations(res.stdout ?? "")).toMatchInlineSnapshot(
      `"::error file=./_pi-ci-bundle-atomic/extracted/pi-ci-atomic/validate-schema-assertion.txt::preflight: validate-schema-assertion.txt EMPTY"`,
    );
  });

  it("both MISSING → two annotations, one per file", () => {
    stage({
      "validate-report.json": null,
      "validate-schema-assertion.txt": null,
    });
    const res = runRecheck();
    expect(res.status).toBe(2);
    expect(annotations(res.stdout ?? "")).toMatchInlineSnapshot(`
      "::error file=./_pi-ci-bundle-atomic/extracted/validate-report.json::preflight: validate-report.json MISSING (expected under ./_pi-ci-bundle-atomic/extracted)
      ::error file=./_pi-ci-bundle-atomic/extracted/validate-schema-assertion.txt::preflight: validate-schema-assertion.txt MISSING (expected under ./_pi-ci-bundle-atomic/extracted)"
    `);
  });

  it("both EMPTY → two annotations, one per file", () => {
    stage({
      "validate-report.json": "",
      "validate-schema-assertion.txt": "",
    });
    const res = runRecheck();
    expect(res.status).toBe(2);
    expect(annotations(res.stdout ?? "")).toMatchInlineSnapshot(`
      "::error file=./_pi-ci-bundle-atomic/extracted/pi-ci-atomic/validate-report.json::preflight: validate-report.json EMPTY
      ::error file=./_pi-ci-bundle-atomic/extracted/pi-ci-atomic/validate-schema-assertion.txt::preflight: validate-schema-assertion.txt EMPTY"
    `);
  });
});
