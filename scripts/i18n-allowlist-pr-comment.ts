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

interface CIContext {
  serverUrl: string;
  repo: string;
  runId: string;
  artifactId: string;
  missing: string[];
}

function resolveCIContext(): CIContext {
  const missing: string[] = [];
  const get = (name: string, fallback: string): string => {
    const v = process.env[name];
    if (!v || v.trim() === "") {
      missing.push(name);
      return fallback;
    }
    return v;
  };
  return {
    serverUrl: get("GITHUB_SERVER_URL", "https://github.com"),
    repo: get("GITHUB_REPOSITORY", "<owner>/<repo>"),
    runId: get("GITHUB_RUN_ID", "0"),
    // I18N_ARTIFACT_ID is wired from the upload-artifact step. Missing it
    // just means we degrade to a run-level artifacts link (still useful).
    artifactId: process.env.I18N_ARTIFACT_ID?.trim() ?? "",
    missing,
  };
}

const ctx = resolveCIContext();
const runUrl = `${ctx.serverUrl}/${ctx.repo}/actions/runs/${ctx.runId}`;
const artifactsUrl = `${runUrl}#artifacts`;
const bundleUrl = ctx.artifactId
  ? `${runUrl}/artifacts/${ctx.artifactId}`
  : artifactsUrl;

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

function build(): string {
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
  lines.push("");
  lines.push("_Posted automatically — updates in place on each push._");
  return lines.join("\n");
}

const body = build();
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, body);
process.stdout.write(body);
