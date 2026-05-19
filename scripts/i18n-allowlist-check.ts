// Enforces .lintrc-i18n-allowlist.json: every
// `eslint-disable[-next-line] no-restricted-syntax -- <reason>` comment in
// src/ must have a matching {file, reason} entry. Also validates the JSON
// structure itself so malformed/missing fields fail CI before drift checks
// even run.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ALLOWLIST_PATH = join(ROOT, ".lintrc-i18n-allowlist.json");
const SRC_DIR = join(ROOT, "src");

interface Entry {
  file: string;
  reason: string;
  notes?: string;
}
interface Allowlist {
  entries: Entry[];
}

// ---------- 1. Structural schema validation -------------------------------
// Hand-rolled validator (no extra dep). Reports ALL issues, then exits.
const schemaErrors: string[] = [];
let raw: unknown;
try {
  raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
} catch (e) {
  console.error(`❌ .lintrc-i18n-allowlist.json is not valid JSON: ${(e as Error).message}`);
  process.exit(1);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

if (!isObject(raw)) {
  schemaErrors.push("root must be a JSON object");
} else {
  if (!Array.isArray((raw as { entries?: unknown }).entries)) {
    schemaErrors.push("`entries` must be an array");
  } else {
    const seenKeys = new Set<string>();
    const entries = (raw as { entries: unknown[] }).entries;
    entries.forEach((e, i) => {
      const where = `entries[${i}]`;
      if (!isObject(e)) {
        schemaErrors.push(`${where} must be an object`);
        return;
      }
      const file = e.file;
      const reason = e.reason;
      const notes = e.notes;
      if (typeof file !== "string" || file.trim() === "") {
        schemaErrors.push(`${where}.file must be a non-empty string`);
      } else if (!file.startsWith("src/")) {
        schemaErrors.push(`${where}.file must be under src/ (got "${file}")`);
      } else if (!existsSync(join(ROOT, file))) {
        schemaErrors.push(`${where}.file does not exist on disk: ${file}`);
      }
      if (typeof reason !== "string" || reason.trim() === "") {
        schemaErrors.push(`${where}.reason must be a non-empty string`);
      }
      if (notes !== undefined && typeof notes !== "string") {
        schemaErrors.push(`${where}.notes must be a string when present`);
      }
      // Disallow unknown keys to keep the file disciplined.
      for (const k of Object.keys(e)) {
        if (!["file", "reason", "notes"].includes(k)) {
          schemaErrors.push(`${where} has unknown key "${k}"`);
        }
      }
      if (typeof file === "string" && typeof reason === "string") {
        const k = `${file}::${reason.trim()}`;
        if (seenKeys.has(k)) {
          schemaErrors.push(`duplicate allowlist entry for ${k} at ${where}`);
        }
        seenKeys.add(k);
      }
    });
  }
}

if (schemaErrors.length) {
  console.error("\n❌ .lintrc-i18n-allowlist.json schema errors:");
  for (const e of schemaErrors) console.error(`  - ${e}`);
  console.error(
    "\nFix the file structure before drift checks can run. See docs/i18n-hardcoded-allowlist.md.",
  );
  process.exit(1);
}

const allowlist = raw as Allowlist;
const allowed = new Set(allowlist.entries.map((e) => `${e.file}::${e.reason.trim()}`));

// ---------- 2. Drift detection vs source comments -------------------------
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
  for (const r of missing) {
    console.error(`  ${r.file}:${r.line}  --  reason: "${r.reason}"`);
  }
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
console.log(
  `✅ i18n allowlist OK — ${allowed.size} entries, ${seen.size} matched in source.`,
);
