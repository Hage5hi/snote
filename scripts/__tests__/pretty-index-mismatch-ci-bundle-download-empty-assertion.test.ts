// Snapshot-style test for the downloader's post-extract content check
// when `validate-schema-assertion.txt` is present but EMPTY. Pins the
// exact ERROR block wording (including the expected extracted path) so
// reviewers relying on the message when triaging bad tarballs get a
// compile-time warning if it changes. Sibling to
// `pretty-index-mismatch-ci-bundle-download-missing.test.ts` (which
// covers the MISSING file case).
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const OUT_DIR = join(REPO_ROOT, "_pi-ci-bundle-atomic");

const hasTools = (() => {
  try {
    return (
      spawnSync("tar", ["--version"]).status === 0 &&
      spawnSync("make", ["--version"]).status === 0
    );
  } catch {
    return false;
  }
})();

const d = hasTools ? describe : describe.skip;

d("pretty-index-mismatch-ci-bundle-download — empty assertion snapshot", () => {
  const shimDir = mkdtempSync(join(tmpdir(), "gh-shim-"));
  const stageDir = mkdtempSync(join(tmpdir(), "gh-stage-"));

  afterAll(() => {
    rmSync(shimDir, { recursive: true, force: true });
    rmSync(stageDir, { recursive: true, force: true });
    rmSync(OUT_DIR, { recursive: true, force: true });
  });

  it("fails with a stable ERROR block when validate-schema-assertion.txt is empty", () => {
    // Both required files present, but validate-schema-assertion.txt is
    // zero-length — isolates the failure to the EMPTY branch.
    const src = join(stageDir, "pi-ci-atomic");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "validate-report.json"), "{}\n");
    writeFileSync(join(src, "validate-schema-assertion.txt"), "");
    const tarball = join(stageDir, "pi-ci-atomic.tar.gz");
    const tarRes = spawnSync(
      "tar",
      ["-czf", tarball, "-C", stageDir, "pi-ci-atomic"],
      { encoding: "utf8" },
    );
    expect(tarRes.status).toBe(0);

    const shim = `#!/usr/bin/env bash
set -euo pipefail
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -D) out="$2"; shift 2 ;;
    *)  shift ;;
  esac
done
mkdir -p "$out"
cp ${JSON.stringify(tarball)} "$out/"
`;
    const shimPath = join(shimDir, "gh");
    writeFileSync(shimPath, shim);
    chmodSync(shimPath, 0o755);

    rmSync(OUT_DIR, { recursive: true, force: true });

    const res = spawnSync(
      "make",
      [
        "-s",
        "pretty-index-mismatch-ci-bundle-download",
        "RUN_ID=stub",
        "PI_CI_SCOPE=atomic",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, PATH: `${shimDir}:${process.env.PATH ?? ""}` },
      },
    );

    const stderr = (res.stderr ?? "")
      .replaceAll(tarball, "<TARBALL>")
      .replace(/Makefile:\d+:/g, "Makefile:<LINE>:");

    expect(res.status).not.toBe(0);
    expect(stderr).toMatchInlineSnapshot(`
      "ERROR: extracted tarball ./_pi-ci-bundle-atomic/pi-ci-atomic.tar.gz failed content checks:
        - EMPTY   file: expected non-empty at ./_pi-ci-bundle-atomic/extracted/pi-ci-atomic/validate-schema-assertion.txt
        extracted tree:
          ./pi-ci-atomic/validate-report.json
          ./pi-ci-atomic/validate-schema-assertion.txt
      make: *** [Makefile:<LINE>: pretty-index-mismatch-ci-bundle-download] Error 2
      "
    `);
  });
});
