// i18n coverage gate.
// Scans the static test/tooling catalog, reports per-language coverage:
//   - missing keys vs English baseline
//   - placeholder mismatches (e.g. {n}, {code}, {bytes}, {when})
//   - empty values
// Exits non-zero when any language is below MIN_COVERAGE_PCT (default 100)
// or when any placeholder mismatch exists. Override via env:
//   I18N_MIN_COVERAGE=95 bun run scripts/i18n-coverage.ts
//   I18N_ALLOW_PLACEHOLDER_MISMATCH=1 ...
import { SUPPORTED_LANGS } from "../src/i18n";
import { dict } from "../src/i18n/catalog";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MIN_COVERAGE_PCT = Number(process.env.I18N_MIN_COVERAGE ?? "100");
const ALLOW_PLACEHOLDER_MISMATCH = process.env.I18N_ALLOW_PLACEHOLDER_MISMATCH === "1";
const VERBOSE = process.env.I18N_VERBOSE === "1" || process.argv.includes("--verbose");
const REPORT_JSON = process.env.I18N_REPORT_JSON ?? "reports/i18n-report.json";
const REPORT_HTML = process.env.I18N_REPORT_HTML ?? "reports/i18n-report.html";

const PLACEHOLDER_RE = /\{(\w+)\}/g;

function placeholders(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(PLACEHOLDER_RE)) out.add(m[1]);
  return out;
}

function eq<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

const enKeys = Object.keys(dict.en) as Array<keyof typeof dict.en>;
const enPlaceholders = new Map<string, Set<string>>();
for (const k of enKeys) enPlaceholders.set(k, placeholders(dict.en[k]));

type Report = {
  lang: string;
  total: number;
  present: number;
  missing: string[];
  empty: string[];
  placeholderMismatch: Array<{ key: string; expected: string[]; got: string[] }>;
  coverage: number;
};

const reports: Report[] = [];

for (const lang of SUPPORTED_LANGS) {
  const tbl = dict[lang] as Record<string, string>;
  const missing: string[] = [];
  const empty: string[] = [];
  const mismatch: Report["placeholderMismatch"] = [];
  let present = 0;

  for (const k of enKeys) {
    const v = tbl[k];
    if (v === undefined) {
      missing.push(k);
      continue;
    }
    if (v.trim() === "") {
      empty.push(k);
      continue;
    }
    present++;
    const got = placeholders(v);
    const want = enPlaceholders.get(k)!;
    if (!eq(got, want)) {
      mismatch.push({
        key: k,
        expected: [...want],
        got: [...got],
      });
    }
  }

  reports.push({
    lang,
    total: enKeys.length,
    present,
    missing,
    empty,
    placeholderMismatch: mismatch,
    coverage: (present / enKeys.length) * 100,
  });
}

// ---------- Pretty print ----------
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
console.log("\ni18n coverage report");
console.log("=".repeat(72));
console.log(
  `${pad("LANG", 6)} ${pad("COVER", 8)} ${pad("PRESENT", 9)} ${pad("MISSING", 9)} ${pad("EMPTY", 7)} ${pad("PH-MISMATCH", 12)}`,
);
console.log("-".repeat(72));
for (const r of reports) {
  console.log(
    `${pad(r.lang, 6)} ${pad(r.coverage.toFixed(1) + "%", 8)} ${pad(String(r.present), 9)} ${pad(String(r.missing.length), 9)} ${pad(String(r.empty.length), 7)} ${pad(String(r.placeholderMismatch.length), 12)}`,
  );
}
console.log("=".repeat(72));
console.log(`Baseline: en (${enKeys.length} keys)`);

// Verbose per-language breakdown (always shown for non-perfect langs, or all
// langs when I18N_VERBOSE=1 / --verbose). Helps CI logs explain what to fix.
for (const r of reports) {
  const hasIssues =
    r.missing.length > 0 || r.empty.length > 0 || r.placeholderMismatch.length > 0;
  if (!hasIssues && !VERBOSE) continue;
  console.log(`\n--- ${r.lang} ---`);
  console.log(`  coverage: ${r.coverage.toFixed(2)}% (${r.present}/${r.total})`);
  if (r.missing.length) {
    console.log(`  missing (${r.missing.length}):`);
    for (const k of r.missing) console.log(`    - ${k}`);
  }
  if (r.empty.length) {
    console.log(`  empty (${r.empty.length}):`);
    for (const k of r.empty) console.log(`    - ${k}`);
  }
  if (r.placeholderMismatch.length) {
    console.log(`  placeholder mismatches (${r.placeholderMismatch.length}):`);
    for (const m of r.placeholderMismatch) {
      console.log(
        `    - ${m.key}: expected {${m.expected.join(",")}}, got {${m.got.join(",")}}`,
      );
    }
  }
}

let failed = false;
for (const r of reports) {
  if (r.coverage < MIN_COVERAGE_PCT) {
    failed = true;
    console.error(
      `\n[FAIL] ${r.lang} below threshold (${r.coverage.toFixed(1)}% < ${MIN_COVERAGE_PCT}%)`,
    );
    if (r.missing.length) console.error("  missing:", r.missing.slice(0, 10).join(", ") + (r.missing.length > 10 ? ` (+${r.missing.length - 10} more)` : ""));
    if (r.empty.length) console.error("  empty:", r.empty.join(", "));
  }
  if (!ALLOW_PLACEHOLDER_MISMATCH && r.placeholderMismatch.length) {
    failed = true;
    console.error(`\n[FAIL] ${r.lang} placeholder mismatches:`);
    for (const m of r.placeholderMismatch.slice(0, 10)) {
      console.error(
        `  ${m.key}: expected {${m.expected.join(",")}}, got {${m.got.join(",")}}`,
      );
    }
  }
}

// ---------- Emit JSON + HTML artifacts ----------
function writeArtifact(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
}

const summary = {
  generatedAt: new Date().toISOString(),
  baselineLang: "en",
  totalKeys: enKeys.length,
  minCoverage: MIN_COVERAGE_PCT,
  passed: !failed,
  languages: reports.map((r) => ({
    lang: r.lang,
    coverage: Number(r.coverage.toFixed(2)),
    present: r.present,
    missingCount: r.missing.length,
    emptyCount: r.empty.length,
    placeholderMismatchCount: r.placeholderMismatch.length,
    missing: r.missing,
    empty: r.empty,
    placeholderMismatch: r.placeholderMismatch,
  })),
};
writeArtifact(REPORT_JSON, JSON.stringify(summary, null, 2));

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const rowsHtml = summary.languages
  .map((l) => {
    const status = l.coverage >= MIN_COVERAGE_PCT && l.placeholderMismatchCount === 0 ? "ok" : "fail";
    return `<tr class="${status}">
  <td>${esc(l.lang)}</td>
  <td>${l.coverage.toFixed(1)}%</td>
  <td>${l.present}/${summary.totalKeys}</td>
  <td>${l.missingCount}</td>
  <td>${l.emptyCount}</td>
  <td>${l.placeholderMismatchCount}</td>
</tr>`;
  })
  .join("\n");

const detailsHtml = summary.languages
  .map((l) => {
    if (l.missingCount + l.emptyCount + l.placeholderMismatchCount === 0)
      return `<section><h3>${esc(l.lang)} — clean</h3></section>`;
    const m = l.missing.length ? `<h4>Missing (${l.missing.length})</h4><ul>${l.missing.map((k) => `<li><code>${esc(k)}</code></li>`).join("")}</ul>` : "";
    const e = l.empty.length ? `<h4>Empty (${l.empty.length})</h4><ul>${l.empty.map((k) => `<li><code>${esc(k)}</code></li>`).join("")}</ul>` : "";
    const ph = l.placeholderMismatch.length
      ? `<h4>Placeholder mismatch (${l.placeholderMismatch.length})</h4><ul>${l.placeholderMismatch.map((x) => `<li><code>${esc(x.key)}</code>: expected {${x.expected.map(esc).join(",")}}, got {${x.got.map(esc).join(",")}}</li>`).join("")}</ul>`
      : "";
    return `<section><h3>${esc(l.lang)}</h3>${m}${e}${ph}</section>`;
  })
  .join("\n");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>i18n coverage report</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #111; }
  h1 { margin-bottom: 0; }
  .meta { color: #666; font-size: 12px; margin-bottom: 1.5rem; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
  th, td { padding: 6px 10px; border: 1px solid #ddd; text-align: left; }
  th { background: #f5f5f5; }
  tr.ok td { background: #f0fdf4; }
  tr.fail td { background: #fef2f2; }
  section { border-top: 1px solid #eee; padding: 1rem 0; }
  h3 { margin: 0 0 0.5rem; }
  h4 { margin: 0.75rem 0 0.25rem; font-size: 13px; color: #555; }
  ul { margin: 0.25rem 0 0.5rem 1.5rem; padding: 0; }
  code { background: #f5f5f5; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .badge.pass { background: #16a34a; color: white; }
  .badge.fail { background: #dc2626; color: white; }
</style></head><body>
<h1>i18n coverage report <span class="badge ${summary.passed ? "pass" : "fail"}">${summary.passed ? "PASS" : "FAIL"}</span></h1>
<p class="meta">Generated ${summary.generatedAt} · baseline <code>en</code> · ${summary.totalKeys} keys · threshold ${summary.minCoverage}%</p>
<table>
  <thead><tr><th>Lang</th><th>Coverage</th><th>Present</th><th>Missing</th><th>Empty</th><th>PH-mismatch</th></tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
${detailsHtml}
</body></html>`;
writeArtifact(REPORT_HTML, html);
console.log(`\nReports written: ${REPORT_JSON}, ${REPORT_HTML}`);

if (failed) {
  console.error("\ni18n coverage gate failed.");
  process.exit(1);
}
console.log("\nAll languages pass i18n coverage gate.");
