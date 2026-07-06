// E2E: reproduces the CI AJV validation step against a hand-crafted
// summary that omits a required per-file field ("reason"). Asserts:
//   1. ajv exits non-zero
//   2. the error text names the missing property + the files[i] path
//   3. our workflow wrapper emits the actionable
//      `::error title=summary-perfile-field-missing::…` annotation
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SCHEMA = resolve(REPO_ROOT, "schemas/report-schema-validation-summary.schema.json");
const has = (bin: string) => { try { return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("bunx") ? describe : describe.skip;

let workdir: string;

d("CI AJV validation — required per-file field missing", () => {
  beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), "pi-ci-ajv-missing-")); });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it("fails fast with a summary-perfile-field-missing ::error when reason is omitted", () => {
    // Valid top-level shape; files[0] is missing the required "reason" field.
    const bad = {
      schema: "pi-ci/report-schema-validation-summary/v1",
      expected_schema_version: "1",
      out_dir: "/tmp/pi-ci-atomic",
      terminated_by: null,
      exit: 5,
      pi_ci_jq_bin: "", jq_bin: "jq", jq_version: "jq-1.7", jq_cmdline: "jq -r …", jq_timeout_secs: "",
      files: [{
        label: "extracted-tree.json",
        path: "/tmp/pi-ci-atomic/extracted-tree.json",
        expected_schema_version: "1",
        actual_schema_version: "99",
        status: "FAIL",
        exit: 5,
        // reason: intentionally omitted
        diff: { schema_version: { expected: "1", actual: "99" } },
        jq_stderr_excerpt: null,
        jq_stderr_path: null,
      }],
    };
    const summary = join(workdir, "report-schema-validation-summary.json");
    const err = join(workdir, "summary-ajv-errors.txt");
    writeFileSync(summary, JSON.stringify(bad));

    // Mirror the exact CI step wrapper.
    const r = spawnSync("bash", [
      "-c",
      `
      set -o pipefail
      out=""
      if ! bunx ajv-cli@5 validate -s "${SCHEMA}" -d "${summary}" --spec=draft7 --all-errors --errors=text 2>"${err}"; then
        echo "::error title=summary-schema-invalid::${summary} does not conform to ${SCHEMA} — see errors below"
        echo "── ajv errors ──"
        cat "${err}" || true
        if grep -qE "files(/|\\[)[0-9]+.*required property" "${err}"; then
          while IFS= read -r line; do
            echo "::error title=summary-perfile-field-missing::$line"
          done < <(grep -E "files(/|\\[)[0-9]+.*required property" "${err}")

        fi
        exit 1
      fi
      `,
    ], { encoding: "utf8" });

    expect(r.status).not.toBe(0);
    const errBody = readFileSync(err, "utf8");
    expect(errBody).toMatch(/required property.*['"]reason['"]/);
    expect(errBody).toMatch(/files\/0|files\[0\]/);
    expect(r.stdout).toContain("::error title=summary-schema-invalid::");
    expect(r.stdout).toContain("::error title=summary-perfile-field-missing::");
    expect(r.stdout).toMatch(/summary-perfile-field-missing::.*reason/);
  }, 60_000);
});
