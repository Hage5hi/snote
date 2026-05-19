// i18n coverage gate.
// Scans src/i18n/index.ts dictionary, reports per-language coverage:
//   - missing keys vs English baseline
//   - placeholder mismatches (e.g. {n}, {code}, {bytes}, {when})
//   - empty values
// Exits non-zero when any language is below MIN_COVERAGE_PCT (default 100)
// or when any placeholder mismatch exists. Override via env:
//   I18N_MIN_COVERAGE=95 bun run scripts/i18n-coverage.ts
//   I18N_ALLOW_PLACEHOLDER_MISMATCH=1 ...
import { dict, SUPPORTED_LANGS } from "../src/i18n";

const MIN_COVERAGE_PCT = Number(process.env.I18N_MIN_COVERAGE ?? "100");
const ALLOW_PLACEHOLDER_MISMATCH = process.env.I18N_ALLOW_PLACEHOLDER_MISMATCH === "1";
const VERBOSE = process.env.I18N_VERBOSE === "1" || process.argv.includes("--verbose");

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

if (failed) {
  console.error("\ni18n coverage gate failed.");
  process.exit(1);
}
console.log("\nAll languages pass i18n coverage gate.");
