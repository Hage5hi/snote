// Enforces .lintrc-i18n-allowlist.json.
//
// Two layers:
//   1. JSON Schema validation (.lintrc-i18n-allowlist.schema.json) via ajv —
//      reports field-level errors with exact instancePath + suggestions for
//      the expected keys, grouped by entries[i].
//   2. Drift detection — every
//      `eslint-disable[-next-line] no-restricted-syntax -- <reason>` comment
//      in src/ must match a {file, reason} entry, and vice versa.
//
// Always emits reports/i18n-allowlist-report.{json,md} so CI artifacts are
// useful even when validation fails. Exported `runAllowlistCheck` is used
// from scripts/__tests__/ so we can unit-test the schema + grouping logic
// without spawning a subprocess.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import Ajv, { type DefinedError, type ErrorObject } from "ajv";

const ENTRY_KEYS = ["file", "reason", "notes"] as const;

export interface RunOptions {
  root?: string;
  allowlistPath?: string;
  schemaPath?: string;
  srcDir?: string;
  reportDir?: string;
  /** Throw instead of process.exit, for tests. */
  throwOnFail?: boolean;
  /** Silence console output, for tests. */
  silent?: boolean;
}

export interface GroupedError {
  group: string; // "(root)" | "entries[i]"
  messages: string[];
}

export interface EntryReport {
  index: number;
  file: string;
  reason: string;
  schemaOk: boolean;
  fileExists: boolean;
  duplicate: boolean;
  matchedInSource: boolean;
  matchedSites: { file: string; line: number }[];
  errors: string[];
}

export interface RunReport {
  ok: boolean;
  schemaOk: boolean;
  driftOk: boolean;
  totals: { entries: number; schemaErrors: number; missing: number; stale: number };
  groupedSchemaErrors: GroupedError[];
  entries: EntryReport[];
  missing: { file: string; reason: string; line: number }[];
  stale: string[];
}

// --- helpers --------------------------------------------------------------

function suggestKey(actual: string): string | undefined {
  const a = actual.toLowerCase();
  for (const k of ENTRY_KEYS) if (k.startsWith(a) || a.startsWith(k)) return k;
  const dist = (x: string, y: string) => {
    const dp: number[][] = Array.from({ length: x.length + 1 }, () =>
      new Array(y.length + 1).fill(0),
    );
    for (let i = 0; i <= x.length; i++) dp[i][0] = i;
    for (let j = 0; j <= y.length; j++) dp[0][j] = j;
    for (let i = 1; i <= x.length; i++)
      for (let j = 1; j <= y.length; j++)
        dp[i][j] =
          x[i - 1] === y[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    return dp[x.length][y.length];
  };
  let best: { k: string; d: number } | undefined;
  for (const k of ENTRY_KEYS) {
    const d = dist(a, k);
    if (d <= 2 && (!best || d < best.d)) best = { k, d };
  }
  return best?.k;
}

function formatAjvError(err: ErrorObject): string {
  const e = err as DefinedError;
  const where = (err.instancePath ?? (err as unknown as {dataPath?: string}).dataPath ?? "") || "(root)";
  switch (e.keyword) {
    case "required":
      return `${where}: missing required field "${e.params.missingProperty}" (expected one of: ${ENTRY_KEYS.join(", ")})`;
    case "additionalProperties": {
      const extra = e.params.additionalProperty;
      const hint = suggestKey(extra);
      return `${where}: unknown key "${extra}"${hint ? ` — did you mean "${hint}"?` : ""} (allowed: ${ENTRY_KEYS.join(", ")})`;
    }
    case "type":
      return `${where}: expected ${e.params.type}, got ${typeof err.data}`;
    case "minLength":
      return `${where}: must be a non-empty string`;
    case "pattern":
      return `${where}: value "${err.data}" does not match required pattern (${e.params.pattern})`;
    default:
      return `${where}: ${err.message ?? "schema violation"}`;
  }
}

function groupSchemaErrors(errors: ErrorObject[]): GroupedError[] {
  const map = new Map<string, string[]>();
  for (const err of errors) {
    const m = (err.instancePath ?? (err as unknown as {dataPath?: string}).dataPath ?? "").match(/^\/entries\/(\d+)/);
    const key = m ? `entries[${m[1]}]` : "(root)";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(formatAjvError(err));
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === "(root)") return -1;
      if (b === "(root)") return 1;
      return Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0);
    })
    .map(([group, messages]) => ({ group, messages }));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const DISABLE_RE =
  /eslint-disable(?:-next-line)?\s+no-restricted-syntax\s*--\s*([^\n*/]+)/g;

interface Entry { file: string; reason: string; notes?: string }

// --- main -----------------------------------------------------------------

export function runAllowlistCheck(opts: RunOptions = {}): RunReport {
  const ROOT = opts.root ?? process.cwd();
  const ALLOWLIST_PATH = opts.allowlistPath ?? join(ROOT, ".lintrc-i18n-allowlist.json");
  const SCHEMA_PATH = opts.schemaPath ?? join(ROOT, ".lintrc-i18n-allowlist.schema.json");
  const SRC_DIR = opts.srcDir ?? join(ROOT, "src");
  const REPORT_DIR = opts.reportDir ?? join(ROOT, "reports");
  const log = (s: string) => { if (!opts.silent) console.error(s); };

  const report: RunReport = {
    ok: true, schemaOk: true, driftOk: true,
    totals: { entries: 0, schemaErrors: 0, missing: 0, stale: 0 },
    groupedSchemaErrors: [], entries: [], missing: [], stale: [],
  };

  // 1. Load
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")); }
  catch (e) {
    report.ok = false; report.schemaOk = false;
    report.groupedSchemaErrors = [{ group: "(root)", messages: [`Invalid JSON: ${(e as Error).message}`] }];
    report.totals.schemaErrors = 1;
    writeReport(REPORT_DIR, report);
    return report;
  }
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;

  // 2. Schema validation
  const ajv = new Ajv({ allErrors: true, verbose: true });
  const validate = ajv.compile(schema);
  const ok = validate(raw);

  if (!ok) {
    const errors = (validate.errors ?? []) as ErrorObject[];
    report.ok = false; report.schemaOk = false;
    report.groupedSchemaErrors = groupSchemaErrors(errors);
    report.totals.schemaErrors = errors.length;
    log("\n❌ .lintrc-i18n-allowlist.json schema errors:\n");
    for (const g of report.groupedSchemaErrors) {
      log(`  ${g.group}:`);
      for (const m of g.messages) log(`    - ${m}`);
    }
    log(
      `\nSummary: ${errors.length} error(s) across ${report.groupedSchemaErrors.length} location(s). ` +
      `Expected entry shape: { ${ENTRY_KEYS.join(", ")} }.`,
    );
    writeReport(REPORT_DIR, report);
    if (opts.throwOnFail) throw new Error("schema");
    return report;
  }

  const allowlist = raw as { entries: Entry[] };
  report.totals.entries = allowlist.entries.length;

  // 3. Post-schema sanity
  const fsErrors: string[] = [];
  const dupKeys = new Set<string>();
  const seenKeys = new Set<string>();
  const fileExistsMap = new Map<number, boolean>();
  allowlist.entries.forEach((e, i) => {
    const exists = existsSync(join(ROOT, e.file));
    fileExistsMap.set(i, exists);
    if (!exists) fsErrors.push(`entries[${i}].file does not exist on disk: ${e.file}`);
    const k = `${e.file}::${e.reason.trim()}`;
    if (seenKeys.has(k)) { fsErrors.push(`entries[${i}] is a duplicate of an earlier entry (${k})`); dupKeys.add(k); }
    seenKeys.add(k);
  });

  // 4. Drift detection
  const allowed = new Set(allowlist.entries.map((e) => `${e.file}::${e.reason.trim()}`));
  const siteMap = new Map<string, { file: string; line: number }[]>();
  const seen = new Set<string>();
  for (const abs of walk(SRC_DIR)) {
    const rel = relative(ROOT, abs).replaceAll("\\", "/");
    const src = readFileSync(abs, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      DISABLE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = DISABLE_RE.exec(lines[i]))) {
        const reason = m[1].trim().replace(/\s*\*\/\s*$/, "").trim();
        const key = `${rel}::${reason}`;
        seen.add(key);
        if (!siteMap.has(key)) siteMap.set(key, []);
        siteMap.get(key)!.push({ file: rel, line: i + 1 });
        if (!allowed.has(key)) report.missing.push({ file: rel, reason, line: i + 1 });
      }
    }
  }
  report.stale = [...allowed].filter((k) => !seen.has(k));
  report.totals.missing = report.missing.length;
  report.totals.stale = report.stale.length;

  // 5. Per-entry rows
  report.entries = allowlist.entries.map((e, i) => {
    const k = `${e.file}::${e.reason.trim()}`;
    const sites = siteMap.get(k) ?? [];
    const errors: string[] = [];
    const exists = fileExistsMap.get(i) ?? false;
    if (!exists) errors.push("file does not exist");
    if (dupKeys.has(k)) errors.push("duplicate entry");
    if (sites.length === 0) errors.push("no matching eslint-disable comment in source (stale)");
    return {
      index: i, file: e.file, reason: e.reason,
      schemaOk: true, fileExists: exists,
      duplicate: dupKeys.has(k),
      matchedInSource: sites.length > 0,
      matchedSites: sites, errors,
    };
  });

  if (fsErrors.length) {
    report.ok = false; report.driftOk = false;
    log("\n❌ .lintrc-i18n-allowlist.json post-schema errors:");
    for (const e of fsErrors) log(`  - ${e}`);
  }
  if (report.missing.length) {
    report.ok = false; report.driftOk = false;
    log("\n❌ Unallowlisted no-restricted-syntax disables:");
    for (const r of report.missing) log(`  ${r.file}:${r.line}  --  reason: "${r.reason}"`);
    log("\nAdd matching {file, reason} entries to .lintrc-i18n-allowlist.json (or wrap the string in t()).");
  }
  if (report.stale.length) {
    report.ok = false; report.driftOk = false;
    log("\n❌ Stale allowlist entries (no matching disable comment):");
    for (const k of report.stale) log(`  ${k}`);
    log("\nRemove them from .lintrc-i18n-allowlist.json.");
  }

  writeReport(REPORT_DIR, report);

  if (report.ok && !opts.silent) {
    console.log(
      `✅ i18n allowlist OK — schema valid, ${allowed.size} entries, ${seen.size} matched in source.`,
    );
  }
  if (!report.ok && opts.throwOnFail) throw new Error("drift");
  return report;
}

function writeReport(dir: string, r: RunReport): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "i18n-allowlist-report.json"), JSON.stringify(r, null, 2));
    writeFileSync(join(dir, "i18n-allowlist-report.md"), renderMarkdown(r));
  } catch {
    /* best-effort */
  }
}

function renderMarkdown(r: RunReport): string {
  const lines: string[] = [];
  lines.push("# i18n Allowlist Validation Report");
  lines.push("");
  lines.push(`**Status:** ${r.ok ? "✅ PASS" : "❌ FAIL"}  ·  Schema: ${r.schemaOk ? "✅" : "❌"}  ·  Drift: ${r.driftOk ? "✅" : "❌"}`);
  lines.push("");
  lines.push(`- Entries: **${r.totals.entries}**`);
  lines.push(`- Schema errors: **${r.totals.schemaErrors}**`);
  lines.push(`- Missing (unallowlisted disables): **${r.totals.missing}**`);
  lines.push(`- Stale (no source match): **${r.totals.stale}**`);
  lines.push("");

  if (r.groupedSchemaErrors.length) {
    lines.push("## Schema errors");
    for (const g of r.groupedSchemaErrors) {
      lines.push(`### ${g.group}`);
      for (const m of g.messages) lines.push(`- ${m}`);
    }
    lines.push("");
  }

  if (r.entries.length) {
    lines.push("## Per-entry results");
    lines.push("");
    lines.push("| # | File | Reason | Status | Matched sites |");
    lines.push("|---|------|--------|--------|---------------|");
    for (const e of r.entries) {
      const status = e.errors.length ? `❌ ${e.errors.join("; ")}` : "✅";
      const sites = e.matchedSites.length
        ? e.matchedSites.map((s) => `\`${s.file}:${s.line}\``).join("<br>")
        : "_none_";
      lines.push(`| ${e.index} | \`${e.file}\` | ${e.reason} | ${status} | ${sites} |`);
    }
    lines.push("");
  }

  if (r.missing.length) {
    lines.push("## Unallowlisted disables (drift)");
    for (const m of r.missing) lines.push(`- \`${m.file}:${m.line}\` — reason: \`${m.reason}\``);
    lines.push("");
  }
  if (r.stale.length) {
    lines.push("## Stale entries");
    for (const s of r.stale) lines.push(`- \`${s}\``);
    lines.push("");
  }
  return lines.join("\n");
}

// CLI entrypoint
const invokedDirectly = (() => {
  try {
    const argv1 = process.argv[1] ?? "";
    return argv1.endsWith("i18n-allowlist-check.ts") || argv1.endsWith("i18n-allowlist-check.js");
  } catch { return false; }
})();
if (invokedDirectly) {
  const r = runAllowlistCheck();
  if (!r.ok) process.exit(1);
}

// Silence unused import warning in some bundlers
void dirname;
