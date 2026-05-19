// Enforces .lintrc-i18n-allowlist.json.
//
// Two layers:
//   1. JSON Schema validation (.lintrc-i18n-allowlist.schema.json) via ajv —
//      reports field-level errors with exact instancePath + suggestions for
//      the expected keys, grouped by entries[i].
//   2. Drift detection — every
//      `eslint-disable[-next-line] no-restricted-syntax -- <reason>` comment
//      in src/ must match a {file, reason} entry, and vice versa.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import Ajv, { type DefinedError, type ErrorObject } from "ajv";

const ROOT = process.cwd();
const ALLOWLIST_PATH = join(ROOT, ".lintrc-i18n-allowlist.json");
const SCHEMA_PATH = join(ROOT, ".lintrc-i18n-allowlist.schema.json");
const SRC_DIR = join(ROOT, "src");

interface Entry {
  file: string;
  reason: string;
  notes?: string;
}
interface Allowlist {
  entries: Entry[];
}

// ---------- 1. Load + JSON Schema validation -----------------------------
let raw: unknown;
try {
  raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
} catch (e) {
  console.error(`❌ .lintrc-i18n-allowlist.json is not valid JSON: ${(e as Error).message}`);
  process.exit(1);
}

let schema: object;
try {
  schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
} catch (e) {
  console.error(`❌ Cannot load schema ${SCHEMA_PATH}: ${(e as Error).message}`);
  process.exit(1);
}

const ajv = new Ajv({ allErrors: true, verbose: true, strict: false });
const validate = ajv.compile(schema);
const ok = validate(raw);

const ENTRY_KEYS = ["file", "reason", "notes"] as const;

function suggestKey(actual: string): string | undefined {
  const a = actual.toLowerCase();
  for (const k of ENTRY_KEYS) if (k.startsWith(a) || a.startsWith(k)) return k;
  // tiny levenshtein for typos
  const dist = (x: string, y: string) => {
    const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
    for (let i = 0; i <= x.length; i++) dp[i][0] = i;
    for (let j = 0; j <= y.length; j++) dp[0][j] = j;
    for (let i = 1; i <= x.length; i++)
      for (let j = 1; j <= y.length; j++)
        dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
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
  const where = err.instancePath || "(root)";
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

if (!ok) {
  const errors = (validate.errors ?? []) as ErrorObject[];
  // Group by entries[i] or "(root)"
  const groups = new Map<string, string[]>();
  for (const err of errors) {
    const m = err.instancePath.match(/^\/entries\/(\d+)/);
    const key = m ? `entries[${m[1]}]` : "(root)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(formatAjvError(err));
  }

  console.error("\n❌ .lintrc-i18n-allowlist.json schema errors:\n");
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === "(root)") return -1;
    if (b === "(root)") return 1;
    const ai = Number(a.match(/\d+/)?.[0] ?? 0);
    const bi = Number(b.match(/\d+/)?.[0] ?? 0);
    return ai - bi;
  });
  for (const k of keys) {
    console.error(`  ${k}:`);
    for (const msg of groups.get(k)!) console.error(`    - ${msg}`);
  }
  console.error(
    `\nSummary: ${errors.length} error(s) across ${groups.size} location(s). Expected entry shape: { ${ENTRY_KEYS.join(", ")} }.`,
  );
  console.error("See docs/i18n-hardcoded-allowlist.md and .lintrc-i18n-allowlist.schema.json.");
  process.exit(1);
}

const allowlist = raw as Allowlist;

// ---------- 2. Cross-entry sanity (post-schema) --------------------------
// Schema cannot encode "file must exist on disk" or "no duplicate (file, reason)".
const fsErrors: string[] = [];
const seenKeys = new Set<string>();
allowlist.entries.forEach((e, i) => {
  if (!existsSync(join(ROOT, e.file))) {
    fsErrors.push(`entries[${i}].file does not exist on disk: ${e.file}`);
  }
  const k = `${e.file}::${e.reason.trim()}`;
  if (seenKeys.has(k)) fsErrors.push(`entries[${i}] is a duplicate of an earlier entry (${k})`);
  seenKeys.add(k);
});
if (fsErrors.length) {
  console.error("\n❌ .lintrc-i18n-allowlist.json post-schema errors:");
  for (const e of fsErrors) console.error(`  - ${e}`);
  process.exit(1);
}

const allowed = new Set(allowlist.entries.map((e) => `${e.file}::${e.reason.trim()}`));

// ---------- 3. Drift detection vs source comments ------------------------
const DISABLE_RE =
  /eslint-disable(?:-next-line)?\s+no-restricted-syntax\s*--\s*([^\n*/]+)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

const missing: { file: string; reason: string; line: number }[] = [];
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
      if (!allowed.has(key)) missing.push({ file: rel, reason, line: i + 1 });
    }
  }
}

const stale = [...allowed].filter((k) => !seen.has(k));

let failed = false;
if (missing.length) {
  failed = true;
  console.error("\n❌ Unallowlisted no-restricted-syntax disables:");
  for (const r of missing) console.error(`  ${r.file}:${r.line}  --  reason: "${r.reason}"`);
  console.error(
    "\nAdd matching {file, reason} entries to .lintrc-i18n-allowlist.json (or wrap the string in t()).",
  );
}
if (stale.length) {
  failed = true;
  console.error("\n❌ Stale allowlist entries (no matching disable comment):");
  for (const k of stale) console.error(`  ${k}`);
  console.error("\nRemove them from .lintrc-i18n-allowlist.json.");
}

if (failed) process.exit(1);
console.log(`✅ i18n allowlist OK — schema valid, ${allowed.size} entries, ${seen.size} matched in source.`);
