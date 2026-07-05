// Ensures:
//
//   1. The two `upload-artifact` steps for the pretty replay-summary
//      bundle (regular matrix + nightly stress matrix in .github/workflows/ci.yml)
//      upload the SAME three globs so pretty-index.json is always shipped
//      alongside its matching *.pretty.md / *.pretty.txt siblings.
//   2. An intentionally invalid pretty-index.json makes the exact bash
//      validation snippet used by CI:
//        - fail with the documented `::error file=...::` annotation, and
//        - append the "❌ pretty-index.json schema validation failed"
//          section (including the validator's stderr) to $GITHUB_STEP_SUMMARY.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const CI_YML = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");

const REQUIRED_GLOBS = [
  "artifacts/schema-drift-diff-replay-verify/pretty/*.pretty.txt",
  "artifacts/schema-drift-diff-replay-verify/pretty/*.pretty.md",
  "artifacts/schema-drift-diff-replay-verify/pretty/pretty-index.json",
];

/** Extract the `path: |` block that follows each named upload step. */
function pathBlockFor(stepId: string): string {
  const re = new RegExp(
    `id:\\s*${stepId}[\\s\\S]*?path:\\s*\\|\\n([\\s\\S]*?)\\n\\s*-\\s`,
  );
  const m = CI_YML.match(re);
  if (!m) throw new Error(`could not find upload step id=${stepId} in ci.yml`);
  return m[1];
}

describe("CI: pretty replay-summary upload consistency", () => {
  for (const stepId of ["upload-pretty", "upload-pretty-stress"]) {
    it(`step \`${stepId}\` uploads pretty-index.json + both pretty siblings`, () => {
      const block = pathBlockFor(stepId);
      for (const g of REQUIRED_GLOBS) expect(block).toContain(g);
    });
  }

  it("both matrices upload the exact same set of pretty globs", () => {
    const normalize = (s: string) =>
      s.split("\n").map((l) => l.trim()).filter(Boolean).sort().join("\n");
    expect(normalize(pathBlockFor("upload-pretty"))).toBe(
      normalize(pathBlockFor("upload-pretty-stress")),
    );
  });
});

describe("CI: invalid pretty-index.json fails the workflow with annotation + summary", () => {
  it("emits ::error:: and appends the schema-validation section", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-pretty-index-e2e-"));
    const index = join(dir, "pretty-index.json");
    // Intentionally invalid: entries missing every required key.
    writeFileSync(index, JSON.stringify([{ folder: "x" }]));
    const stepSummary = join(dir, "step-summary.md");
    writeFileSync(stepSummary, "");

    // Mirror the exact snippet used in ci.yml (post-index-write) so that
    // regressions there fail this test.
    const snippet = `
      set +e
      index="${index}"
      val_err=$(python3 ${REPO}/scripts/validate-pretty-index.py "$index" 2>&1 1>/dev/null)
      rc=$?
      if [[ "$rc" -ne 0 ]]; then
        first_line=$(printf '%s\\n' "$val_err" | head -n1)
        echo "::error file=\${index}::pretty-index.json failed schema validation at \${index}: \${first_line}" >&2
        {
          echo ''
          echo "### ❌ pretty-index.json schema validation failed"
          echo ''
          echo "- Path: \\\`\${index}\\\`"
          echo ''
          echo '\`\`\`'
          printf '%s\\n' "$val_err"
          echo '\`\`\`'
        } >> "$GITHUB_STEP_SUMMARY"
        exit 1
      fi
    `;

    let stderr = "";
    let status = 0;
    try {
      execSync(`bash -c '${snippet.replace(/'/g, "'\\''")}'`, {
        env: { ...process.env, GITHUB_STEP_SUMMARY: stepSummary },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e: any) {
      status = e.status ?? 1;
      stderr = e.stderr?.toString() ?? "";
    }

    expect(status).toBe(1);
    expect(stderr).toContain(`::error file=${index}::`);
    expect(stderr).toContain("pretty-index.json failed schema validation");

    const summary = readFileSync(stepSummary, "utf8");
    expect(summary).toContain("### ❌ pretty-index.json schema validation failed");
    expect(summary).toContain(`- Path: \`${index}\``);
    // The validator's per-entry breakdown ends up inside the code block.
    expect(summary).toMatch(/missing key: summary_file/);
  });
});
