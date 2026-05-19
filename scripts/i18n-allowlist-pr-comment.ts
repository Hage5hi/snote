// Builds a markdown body for the i18n-allowlist PR sticky comment.
//
// Reads reports/i18n-allowlist-report.json (produced by
// scripts/i18n-allowlist-check.ts) and emits a short pass/fail summary
// plus links to the uploaded CI artifacts.
//
// Outputs to stdout AND writes reports/_i18n-allowlist-pr-comment.md so
// the GitHub Action can feed it to marocchino/sticky-pull-request-comment
// via its `path:` input.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
const REPORT_PATH = join(ROOT, "reports", "i18n-allowlist-report.json");
const OUT_PATH = join(ROOT, "reports", "_i18n-allowlist-pr-comment.md");

export interface CIContext {
  serverUrl: string;
  repo: string;
  runId: string;
  artifactId: string;
  /** GitHub env vars (excluding the optional I18N_ARTIFACT_ID) that were unset/empty. */
  missing: string[];
}

export const REQUIRED_GH_ENV = [
  "GITHUB_SERVER_URL",
  "GITHUB_REPOSITORY",
  "GITHUB_RUN_ID",
] as const;

const FALLBACKS: Record<(typeof REQUIRED_GH_ENV)[number], string> = {
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "<owner>/<repo>",
  GITHUB_RUN_ID: "0",
};

/**
 * Resolves the GitHub Actions context used to build artifact/run URLs.
 * Tracks every required env var that was missing or empty so callers can
 * fail gracefully (warning + placeholder URLs) instead of crashing.
 *
 * Pure: reads from the provided `env` map (defaults to process.env) and
 * has no side effects, so it's safe to unit-test.
 */
export function resolveCIContext(
  env: NodeJS.ProcessEnv = process.env,
): CIContext {
  const missing: string[] = [];
  const get = (name: (typeof REQUIRED_GH_ENV)[number]): string => {
    const v = env[name];
    if (!v || v.trim() === "") {
      missing.push(name);
      return FALLBACKS[name];
    }
    return v;
  };
  return {
    serverUrl: get("GITHUB_SERVER_URL"),
    repo: get("GITHUB_REPOSITORY"),
    runId: get("GITHUB_RUN_ID"),
    // I18N_ARTIFACT_ID is wired from the upload-artifact step. Missing it
    // just means we degrade to a run-level artifacts link (still useful),
    // so it isn't tracked in `missing[]`.
    artifactId: env.I18N_ARTIFACT_ID?.trim() ?? "",
    missing,
  };
}

export function buildUrls(ctx: CIContext): {
  runUrl: string;
  artifactsUrl: string;
  bundleUrl: string;
} {
  const runUrl = `${ctx.serverUrl}/${ctx.repo}/actions/runs/${ctx.runId}`;
  const artifactsUrl = `${runUrl}#artifacts`;
  const bundleUrl = ctx.artifactId
    ? `${runUrl}/artifacts/${ctx.artifactId}`
    : artifactsUrl;
  return { runUrl, artifactsUrl, bundleUrl };
}

interface Report {
  ok: boolean;
  schemaOk: boolean;
  driftOk: boolean;
  totals: { entries: number; schemaErrors: number; missing: number; stale: number };
}

function loadReport(): Report | null {
  if (!existsSync(REPORT_PATH)) return null;
  try {
    return JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Report;
  } catch {
    return null;
  }
}

export function build(ctx: CIContext): string {
  const { runUrl, artifactsUrl, bundleUrl } = buildUrls(ctx);
  const r = loadReport();
  const lines: string[] = [];
  lines.push("### 🌐 i18n audit + allowlist artifacts");
  lines.push("");

  if (!r) {
    lines.push("> ⚠️ `reports/i18n-allowlist-report.json` was not produced — the allowlist script likely crashed before writing.");
  } else {
    const status = r.ok ? "✅ **PASS**" : "❌ **FAIL**";
    lines.push(`**Allowlist status:** ${status} · Schema: ${r.schemaOk ? "✅" : "❌"} · Drift: ${r.driftOk ? "✅" : "❌"}`);
    lines.push("");
    lines.push(`| Entries | Schema errors | Missing | Stale |`);
    lines.push(`|---------|---------------|---------|-------|`);
    lines.push(
      `| ${r.totals.entries} | ${r.totals.schemaErrors} | ${r.totals.missing} | ${r.totals.stale} |`,
    );
    lines.push("");
    lines.push(`Report path: \`reports/i18n-allowlist-report.json\` · \`reports/i18n-allowlist-report.md\``);
  }

  lines.push("");
  lines.push("**Artifact:** `i18n-report` — contains `reports/i18n-audit-diff.{json,md}`, `reports/i18n-report.{json,html}`, `reports/i18n-allowlist-report.{json,md}`, `.lintrc-i18n-allowlist.json`.");
  lines.push("");
  lines.push(`- 📦 [Download artifact bundle](${bundleUrl})`);
  lines.push(`- 🧾 [All artifacts for this run](${artifactsUrl})`);
  lines.push(`- 🔎 [Job logs](${runUrl})`);

  if (ctx.missing.length) {
    lines.push("");
    lines.push(
      `> ℹ️ Some CI env vars were missing — links may be incomplete: \`${ctx.missing.join("`, `")}\`. ` +
        "This usually means the script was run outside of GitHub Actions.",
    );
  }

  lines.push("");
  lines.push("_Posted automatically — updates in place on each push._");
  return lines.join("\n");
}

// CLI entrypoint — only runs when invoked directly so importers (tests)
// don't trigger file writes or stdout/stderr side effects.
const invokedDirectly = (() => {
  try {
    const argv1 = process.argv[1] ?? "";
    return (
      argv1.endsWith("i18n-allowlist-pr-comment.ts") ||
      argv1.endsWith("i18n-allowlist-pr-comment.js")
    );
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  const ctx = resolveCIContext();
  const body = build(ctx);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, body);
  process.stdout.write(body);
  if (ctx.missing.length) {
    // Soft-fail: don't crash CI when invoked locally, just surface the issue.
    console.error(
      `\n⚠️ i18n PR comment: missing CI env var(s): ${ctx.missing.join(", ")}. ` +
        "Links fall back to placeholders. Set them in the workflow step or run via GitHub Actions.",
    );
  }
}
