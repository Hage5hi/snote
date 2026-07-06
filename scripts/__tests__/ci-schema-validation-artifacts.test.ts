// CI workflow contract: schema-validation failure artifacts include the
// validator log, summary JSON, and any per-file jq stderr sidecars whose
// paths are referenced by report-schema-validation-summary.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CI_YML = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");

describe("CI schema-validation failure artifacts", () => {
  it.each(["atomic", "stress"])("uploads jq stderr sidecars for %s", (scope) => {
    const re = new RegExp(
      `pretty-index-mismatch-ci-schema-validator-io-${scope}[^]*?path:\\s*\\|\\n([^]*?)\\n\\s*if-no-files-found`,
    );
    const block = CI_YML.match(re)?.[1] ?? "";
    expect(block).toContain(`/tmp/pi-ci-${scope}/report-schema-validation-log.txt`);
    expect(block).toContain(`/tmp/pi-ci-${scope}/report-schema-validation-summary.json`);
    expect(block).toContain(`/tmp/pi-ci-${scope}/report-schema-jq-*.stderr.txt`);
  });
});