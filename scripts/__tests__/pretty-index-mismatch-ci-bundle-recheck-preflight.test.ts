// Snapshot-style tests for the `pretty-index-mismatch-ci-bundle-recheck`
// preflight — pins the exact stderr wording AND the exit code for every
// missing/empty combination of `validate-report.json` and
// `validate-schema-assertion.txt` in the locally-extracted bundle.
//
// Sibling to `…-bundle-download-*.test.ts` which cover the downloader's
// post-extract content check. This file covers the local re-check path
// (no `gh` shim needed — we stage the extracted directory directly).
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SCOPE = "atomic";
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
    if (contents === null) continue; // skip => file missing
    writeFileSync(join(EXTRACTED, name), contents);
  }
}

function runRecheck() {
  return spawnSync(
    "make",
    ["-s", "pretty-index-mismatch-ci-bundle-recheck", `PI_CI_SCOPE=${SCOPE}`],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
}

function cleanStderr(s: string): string {
  return s.replace(/Makefile:\d+:/g, "Makefile:<LINE>:");
}

d("pretty-index-mismatch-ci-bundle-recheck — preflight snapshots", () => {
  beforeEach(() => rmSync(OUT_DIR, { recursive: true, force: true }));
  afterEach(() => rmSync(OUT_DIR, { recursive: true, force: true }));

  it("report MISSING, assertion OK", () => {
    stage({
      "validate-report.json": null,
      "validate-schema-assertion.txt": "noop\n",
    });
    const res = runRecheck();
    expect(res.status).toBe(2);
    expect(cleanStderr(res.stderr ?? "")).toMatchInlineSnapshot(`
      "ERROR: preflight: validate-report.json MISSING under ./_pi-ci-bundle-atomic/extracted
        hint: re-run 'make pretty-index-mismatch-ci-bundle-download RUN_ID=<id> PI_CI_SCOPE=atomic'
      make: *** [Makefile:<LINE>: pretty-index-mismatch-ci-bundle-recheck] Error 2
      "
    `);
  });

  it("report EMPTY, assertion OK", () => {
    stage({
      "validate-report.json": "",
      "validate-schema-assertion.txt": "noop\n",
    });
    const res = runRecheck();
    expect(res.status).toBe(2);
    expect(cleanStderr(res.stderr ?? "")).toMatchInlineSnapshot(`
      "ERROR: preflight: validate-report.json EMPTY at ./_pi-ci-bundle-atomic/extracted/pi-ci-atomic/validate-report.json
        hint: re-run 'make pretty-index-mismatch-ci-bundle-download RUN_ID=<id> PI_CI_SCOPE=atomic'
      make: *** [Makefile:<LINE>: pretty-index-mismatch-ci-bundle-recheck] Error 2
      "
    `);
  });

  it("report OK, assertion MISSING", () => {
    stage({
      "validate-report.json": "{}\n",
      "validate-schema-assertion.txt": null,
    });
    const res = runRecheck();
    expect(res.status).toBe(2);
    expect(cleanStderr(res.stderr ?? "")).toMatchInlineSnapshot(`
      "ERROR: preflight: validate-schema-assertion.txt MISSING under ./_pi-ci-bundle-atomic/extracted
        hint: re-run 'make pretty-index-mismatch-ci-bundle-download RUN_ID=<id> PI_CI_SCOPE=atomic'
      make: *** [Makefile:<LINE>: pretty-index-mismatch-ci-bundle-recheck] Error 2
      "
    `);
  });

  it("report OK, assertion EMPTY", () => {
    stage({
      "validate-report.json": "{}\n",
      "validate-schema-assertion.txt": "",
    });
    const res = runRecheck();
    expect(res.status).toBe(2);
    expect(cleanStderr(res.stderr ?? "")).toMatchInlineSnapshot(`
      "ERROR: preflight: validate-schema-assertion.txt EMPTY at ./_pi-ci-bundle-atomic/extracted/pi-ci-atomic/validate-schema-assertion.txt
        hint: re-run 'make pretty-index-mismatch-ci-bundle-download RUN_ID=<id> PI_CI_SCOPE=atomic'
      make: *** [Makefile:<LINE>: pretty-index-mismatch-ci-bundle-recheck] Error 2
      "
    `);
  });

  it("both MISSING", () => {
    stage({
      "validate-report.json": null,
      "validate-schema-assertion.txt": null,
    });
    const res = runRecheck();
    expect(res.status).toBe(2);
    expect(cleanStderr(res.stderr ?? "")).toMatchInlineSnapshot(`
      "ERROR: preflight: validate-report.json MISSING under ./_pi-ci-bundle-atomic/extracted
      ERROR: preflight: validate-schema-assertion.txt MISSING under ./_pi-ci-bundle-atomic/extracted
        hint: re-run 'make pretty-index-mismatch-ci-bundle-download RUN_ID=<id> PI_CI_SCOPE=atomic'
      make: *** [Makefile:<LINE>: pretty-index-mismatch-ci-bundle-recheck] Error 2
      "
    `);
  });

  it("both EMPTY", () => {
    stage({
      "validate-report.json": "",
      "validate-schema-assertion.txt": "",
    });
    const res = runRecheck();
    expect(res.status).toBe(2);
    expect(cleanStderr(res.stderr ?? "")).toMatchInlineSnapshot(`
      "ERROR: preflight: validate-report.json EMPTY at ./_pi-ci-bundle-atomic/extracted/pi-ci-atomic/validate-report.json
      ERROR: preflight: validate-schema-assertion.txt EMPTY at ./_pi-ci-bundle-atomic/extracted/pi-ci-atomic/validate-schema-assertion.txt
        hint: re-run 'make pretty-index-mismatch-ci-bundle-download RUN_ID=<id> PI_CI_SCOPE=atomic'
      make: *** [Makefile:<LINE>: pretty-index-mismatch-ci-bundle-recheck] Error 2
      "
    `);
  });
});
