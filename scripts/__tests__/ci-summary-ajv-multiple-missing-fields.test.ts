// E2E: when the per-file object omits MULTIPLE required fields, the CI
// AJV wrapper must emit one `::error title=summary-perfile-field-missing`
// annotation per missing field, each in the strict format:
//   files/<index> missing required field: <name>
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = process.cwd();
const SCHEMA = resolve(REPO, "schemas/report-schema-validation-summary.schema.json");
const has = (b: string) => { try { return spawnSync("sh", ["-c", `command -v ${b}`]).status === 0; } catch { return false; } };
const d = has("bash") && has("bunx") ? describe : describe.skip;

let work: string;
d("CI AJV wrapper — multiple missing per-file fields", () => {
  beforeEach(() => { work = mkdtempSync(join(tmpdir(), "pi-ci-ajv-multi-")); });
  afterEach(() => { rmSync(work, { recursive: true, force: true }); });

  it("emits one annotation per missing field in the strict format", () => {
    // files[0] omits `reason`, `diff`, and `jq_stderr_excerpt` at once.
    const bad = {
      schema: "pi-ci/report-schema-validation-summary/v1",
      expected_schema_version: "1", out_dir: "/tmp/x",
      terminated_by: null, exit: 5,
      pi_ci_jq_bin: "", jq_bin: "jq", jq_version: "jq-1.7", jq_cmdline: "jq .", jq_timeout_secs: "",
      files: [{
        label: "extracted-tree.json", path: "/tmp/x/extracted-tree.json",
        expected_schema_version: "1", actual_schema_version: "99",
        status: "FAIL", exit: 5,
        // reason: OMITTED
        // diff: OMITTED
        // jq_stderr_excerpt: OMITTED
        jq_stderr_path: null,
      }],
    };
    const summary = join(work, "report-schema-validation-summary.json");
    const err = join(work, "summary-ajv-errors.txt");
    writeFileSync(summary, JSON.stringify(bad));

    const r = spawnSync("bash", ["-c", `
      set -o pipefail
      if ! bunx ajv-cli@5 validate -s "${SCHEMA}" -d "${summary}" --spec=draft7 --all-errors --errors=text 2>"${err}"; then
        echo "::error title=summary-schema-invalid::${summary} does not conform to ${SCHEMA}"
        if grep -qE "files(/|\\[)[0-9]+.*required property" "${err}"; then
          while IFS= read -r line; do
            idx="$(printf '%s' "$line" | sed -nE "s/.*(files(\\/|\\[)[0-9]+).*/\\1/p" | head -1 | tr '[' '/' | tr -d ']')"
            field="$(printf '%s' "$line" | sed -nE "s/.*required property[[:space:]]+[\\"']?([A-Za-z0-9_]+)[\\"']?.*/\\1/p" | head -1)"
            echo "::error title=summary-perfile-field-missing::\${idx} missing required field: \${field}"
          done < <(grep -E "files(/|\\[)[0-9]+.*required property" "${err}")
        fi
        exit 1
      fi
    `], { encoding: "utf8" });

    expect(r.status).not.toBe(0);
    for (const name of ["reason", "diff", "jq_stderr_excerpt"]) {
      expect(r.stdout).toContain(
        `::error title=summary-perfile-field-missing::files/0 missing required field: ${name}`,
      );
    }
    // Sanity: at least three distinct per-file annotations were emitted.
    const matches = r.stdout.match(/::error title=summary-perfile-field-missing::files\/0 missing required field: /g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
