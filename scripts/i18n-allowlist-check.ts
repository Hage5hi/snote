// Enforces .lintrc-i18n-allowlist.json: every
// `eslint-disable[-next-line] no-restricted-syntax -- <reason>` comment in
// src/ must have a matching {file, reason} entry. Fails CI on drift so new
// hardcoded strings cannot sneak in by copy-pasting an existing disable.
import { readdirSync, readFileSync, statSync } from "node:fs";
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

const allowlist: Allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
const allowed = new Set(allowlist.entries.map((e) => `${e.file}::${e.reason.trim()}`));

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

// Detect stale allowlist entries (defined but no longer referenced).
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
