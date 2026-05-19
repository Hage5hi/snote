// Builds the sticky "i18n CLI test coverage" PR comment body used by the
// ubuntu CI job. Extracted from inline bash in .github/workflows/ci.yml
// so the variant logic (validator-failed vs. success, missing artifact
// IDs) is unit-testable and a single `linkOrMissing` helper is the
// source of truth across every comment variant.
//
// Variants:
//   • "success"           — all artifact links rendered; missing IDs
//                           degrade to an explicit "_artifact not uploaded
//                           for this run_" line so reviewers can tell
//                           WHICH artifact is missing (not just "broken
//                           link").
//   • "validator-failed"  — link block fully suppressed; replaced with a
//                           clear error pointing reviewers to the run
//                           logs. The upload steps still run (gated by
//                           `if: always()` in the workflow), so artifacts
//                           remain downloadable from the run page even
//                           when links are suppressed in the comment.
//
// Usage (CLI):
//   bun run scripts/ci-build-coverage-pr-comment.ts \
//     --out reports/_ci/coverage-pr-comment.md
//
// Reads env vars: GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID,
//   VALIDATE_OUTCOME, COVERAGE_ARTIFACT_ID, DEBUG_BUNDLE_ARTIFACT_ID,
//   STEP_SUMMARY_ARTIFACT_ID, FAILURE_BREAKDOWN_ARTIFACT_ID.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface CoverageCommentInput {
  runUrl: string;
  /** Outcome string of the validate_breakdown step (GitHub Actions). */
  validateOutcome: string;
  coverageArtifactId?: string;
  debugBundleArtifactId?: string;
  stepSummaryArtifactId?: string;
  failureBreakdownArtifactId?: string;
}

/**
 * Render a single artifact bullet — either as a clickable link or as an
 * explicit "_artifact not uploaded for this run_" notice naming the
 * specific artifact. Reviewers see EXACTLY which artifact is missing
 * (debug-bundle, step-summary, failure-breakdown, coverage), not just a
 * generic "links broken" message.
 */
export function linkOrMissing(
  id: string | undefined,
  label: string,
  hint: string,
  runUrl: string,
): string {
  if (id && id.trim() !== "") {
    return `- [${label}](${runUrl}/artifacts/${id}) — ${hint}`;
  }
  return `- _${label}: artifact not uploaded for this run_ — ${hint}`;
}

/**
 * Build the full markdown body of the sticky PR comment. Pure: takes
 * everything it needs as input, returns a string. Unit-tested in
 * scripts/__tests__/ci-build-coverage-pr-comment.test.ts.
 */
export function buildCoverageComment(input: CoverageCommentInput): string {
  const { runUrl, validateOutcome } = input;
  // Hard gate: if validation failed, suppress every artifact link so
  // reviewers never click into a malformed payload. The upload steps
  // themselves still run (they use `if: always()`), so the artifacts
  // remain on the run page — only the comment links are suppressed.
  if (validateOutcome !== "success") {
    return [
      "### i18n CLI test coverage",
      "",
      "❌ **Breakdown JSON validation failed** — artifact links are suppressed to avoid pointing reviewers at malformed payloads.",
      "",
      `See the [\`Validate failure-breakdown.json shape\`](${runUrl}) step in the run logs for the specific schema / shape error, then re-run the job once it's fixed.`,
      "",
    ].join("\n");
  }
  const lines: string[] = [];
  lines.push("### i18n CLI test coverage");
  lines.push("");
  lines.push(
    linkOrMissing(
      input.coverageArtifactId,
      "📊 HTML coverage report",
      "browsable view of `scripts/i18n-allowlist-*.ts`; open `index.html` after download",
      runUrl,
    ),
  );
  lines.push("");
  lines.push("#### Debugging artifacts");
  lines.push(
    linkOrMissing(
      input.debugBundleArtifactId,
      "📦 debug-bundle",
      "all of the below + raw vitest log in one zip",
      runUrl,
    ),
  );
  lines.push(
    linkOrMissing(
      input.stepSummaryArtifactId,
      "📝 step-summary.md",
      "rendered markdown GitHub shows in the job UI",
      runUrl,
    ),
  );
  lines.push(
    linkOrMissing(
      input.failureBreakdownArtifactId,
      "🧩 failure-breakdown.json",
      "machine-readable suite/test/diff payload (schemaVersion ≥ 1)",
      runUrl,
    ),
  );
  lines.push("");
  lines.push("#### Per-OS matrix artifacts");
  lines.push(
    "Uploaded by the i18n CLI matrix job — one zip per OS, each containing parity + flags breakdown JSON, the per-OS step summary, and the raw vitest log:",
  );
  lines.push(
    "- `i18n-cli-debug-bundle-ubuntu-latest` / `-macos-latest` / `-windows-latest` — 📦 debug-bundle per OS",
  );
  lines.push(
    "- `i18n-cli-failure-breakdown-json-ubuntu-latest` / `-macos-latest` / `-windows-latest` — 🧩 parity + flags breakdown JSON per OS",
  );
  lines.push(
    "- `i18n-cli-step-summary-ubuntu-latest` / `-macos-latest` / `-windows-latest` — 📝 step-summary.md per OS",
  );
  lines.push("");
  lines.push(`Direct downloads: [run artifacts page](${runUrl}#artifacts).`);
  lines.push("");
  return lines.join("\n");
}

/** Resolve all comment inputs from process.env — the shape CI passes. */
export function resolveFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CoverageCommentInput {
  const server = env.GITHUB_SERVER_URL || "https://github.com";
  const repo = env.GITHUB_REPOSITORY || "<owner>/<repo>";
  const runId = env.GITHUB_RUN_ID || "0";
  return {
    runUrl: `${server}/${repo}/actions/runs/${runId}`,
    validateOutcome: env.VALIDATE_OUTCOME || "success",
    coverageArtifactId: env.COVERAGE_ARTIFACT_ID,
    debugBundleArtifactId: env.DEBUG_BUNDLE_ARTIFACT_ID,
    stepSummaryArtifactId: env.STEP_SUMMARY_ARTIFACT_ID,
    failureBreakdownArtifactId: env.FAILURE_BREAKDOWN_ARTIFACT_ID,
  };
}

const invokedDirectly = (() => {
  try {
    const arg = process.argv[1] ?? "";
    return (
      arg.endsWith("ci-build-coverage-pr-comment.ts") ||
      arg.endsWith("ci-build-coverage-pr-comment.js")
    );
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const body = buildCoverageComment(resolveFromEnv());
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, body);
  }
  process.stdout.write(body);
}
