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

const SERVER = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const REPO = process.env.GITHUB_REPOSITORY ?? "<owner>/<repo>";
const RUN_ID = process.env.GITHUB_RUN_ID ?? "0";
const ARTIFACT_ID = process.env.I18N_ARTIFACT_ID ?? "";

const runUrl = `${SERVER}/${REPO}/actions/runs/${RUN_ID}`;
const artifactsUrl = `${runUrl}#artifacts`;
const bundleUrl = ARTIFACT_ID
  ? `${runUrl}/artifacts/${ARTIFACT_ID}`
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
