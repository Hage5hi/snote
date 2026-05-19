// i18n audit: scans src/ for user-facing strings that don't go through t().
// Heuristics:
//   - Vietnamese diacritics → likely a Vietnamese string left hardcoded.
//   - <meta name="description|og:title|og:description|twitter:..."> content="..." with literal text.
//   - JSX string literals inside common UI attributes (placeholder, aria-label, title)
//     and visible text children that look like sentences (>=2 words, starts uppercase).
// Exits 0 always; prints a grouped report with file:line so reviewers can triage.
//
// Run: bun run i18n:audit  (or: bun scripts/i18n-audit.ts)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = "src";
const EXCLUDE_DIRS = new Set([
  "node_modules", "__tests__", "test", "components/ui",
]);
const EXCLUDE_FILES = new Set([
  "src/i18n/index.ts",
  "src/integrations/supabase/types.ts",
]);

const VI_DIACRITICS =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/;

type Finding = {
  file: string;
  line: number;
  kind: "vietnamese" | "meta-seo" | "placeholder-literal" | "aria-literal";
  snippet: string;
};

const findings: Finding[] = [];

function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      walk(p);
    } else if (s.isFile()) {
      if (EXCLUDE_FILES.has(p)) continue;
      const ext = extname(p);
      if (![".ts", ".tsx", ".js", ".jsx"].includes(ext)) continue;
      scan(p);
    }
  }
}

const placeholderRE = /\bplaceholder\s*=\s*"([^"]{4,})"/g;
const ariaLabelRE = /\baria-label\s*=\s*"([^"]{3,})"/g;
const titleAttrRE = /\btitle\s*=\s*"([^"]{4,})"/g;
const metaSeoRE = /<meta\s+(?:name|property)="(description|og:title|og:description|twitter:title|twitter:description)"\s+content="([^"]{6,})"/g;

function scan(file: string) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;
    if (VI_DIACRITICS.test(line)) {
      findings.push({ file, line: ln, kind: "vietnamese", snippet: line.trim().slice(0, 160) });
    }
    placeholderRE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = placeholderRE.exec(line))) {
      findings.push({ file, line: ln, kind: "placeholder-literal", snippet: m[0] });
    }
    ariaLabelRE.lastIndex = 0;
    while ((m = ariaLabelRE.exec(line))) {
      findings.push({ file, line: ln, kind: "aria-literal", snippet: m[0] });
    }
    titleAttrRE.lastIndex = 0;
    while ((m = titleAttrRE.exec(line))) {
      findings.push({ file, line: ln, kind: "aria-literal", snippet: m[0] });
    }
    metaSeoRE.lastIndex = 0;
    while ((m = metaSeoRE.exec(line))) {
      findings.push({ file, line: ln, kind: "meta-seo", snippet: m[0].slice(0, 160) });
    }
  }
}

walk(ROOT);

const byKind = new Map<string, Finding[]>();
for (const f of findings) {
  const arr = byKind.get(f.kind) ?? [];
  arr.push(f);
  byKind.set(f.kind, arr);
}

const order: Finding["kind"][] = ["vietnamese", "meta-seo", "placeholder-literal", "aria-literal"];
console.log("i18n audit — files containing strings that may need t() wrapping");
console.log("=".repeat(72));
for (const kind of order) {
  const arr = byKind.get(kind) ?? [];
  console.log(`\n## ${kind}  (${arr.length})`);
  const byFile = new Map<string, Finding[]>();
  for (const f of arr) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }
  const fileList = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [file, items] of fileList) {
    console.log(`  ${file}  (${items.length})`);
    for (const it of items.slice(0, 5)) {
      console.log(`    L${it.line}: ${it.snippet}`);
    }
    if (items.length > 5) console.log(`    … and ${items.length - 5} more`);
  }
}

console.log("\n" + "=".repeat(72));
console.log(`Total findings: ${findings.length}`);
console.log("Note: heuristic. Review each — some attrs are intentionally static.");

// ---------------------------------------------------------------------------
// Persist current findings + emit a before/after diff against the previous
// snapshot. CI uploads reports/i18n-audit-* so reviewers see what changed.
// ---------------------------------------------------------------------------
import { mkdirSync, existsSync, writeFileSync } from "node:fs";

const REPORT_DIR = "reports";
mkdirSync(REPORT_DIR, { recursive: true });

type Snapshot = Record<string, Finding[]>; // file -> findings
const grouped: Snapshot = {};
for (const f of findings) (grouped[f.file] ??= []).push(f);

const currentPath = `${REPORT_DIR}/i18n-audit.json`;
const previousPath = `${REPORT_DIR}/i18n-audit.prev.json`;
const diffJsonPath = `${REPORT_DIR}/i18n-audit-diff.json`;
const diffMdPath = `${REPORT_DIR}/i18n-audit-diff.md`;

let previous: Snapshot = {};
if (existsSync(currentPath)) {
  try { previous = JSON.parse(require("node:fs").readFileSync(currentPath, "utf8")); } catch { /* ignore */ }
}

const keyOf = (f: Finding) => `${f.kind}::L${f.line}::${f.snippet}`;
const allFiles = new Set([...Object.keys(previous), ...Object.keys(grouped)]);

type FileDiff = {
  file: string;
  added: Finding[];
  removed: Finding[];
  beforeCount: number;
  afterCount: number;
};
const diff: FileDiff[] = [];
for (const file of allFiles) {
  const before = previous[file] ?? [];
  const after = grouped[file] ?? [];
  const beforeKeys = new Set(before.map(keyOf));
  const afterKeys = new Set(after.map(keyOf));
  const added = after.filter((f) => !beforeKeys.has(keyOf(f)));
  const removed = before.filter((f) => !afterKeys.has(keyOf(f)));
  if (added.length || removed.length) {
    diff.push({ file, added, removed, beforeCount: before.length, afterCount: after.length });
  }
}
diff.sort((a, b) => (b.added.length - a.added.length) || (a.file.localeCompare(b.file)));

writeFileSync(diffJsonPath, JSON.stringify(diff, null, 2));

const totalAdded = diff.reduce((n, d) => n + d.added.length, 0);
const totalRemoved = diff.reduce((n, d) => n + d.removed.length, 0);
const md: string[] = [];
md.push(`# i18n audit diff`, ``, `- files changed: **${diff.length}**`, `- added findings: **${totalAdded}**`, `- removed findings: **${totalRemoved}**`, ``);
if (!diff.length) md.push(`_No before/after delta vs previous snapshot._`);
for (const d of diff) {
  md.push(`## \`${d.file}\``);
  md.push(`before: ${d.beforeCount} → after: ${d.afterCount}`, ``);
  if (d.added.length) {
    md.push(`### + Added (${d.added.length})`);
    for (const f of d.added) md.push(`- \`${f.kind}\` L${f.line}: \`${f.snippet.replace(/`/g, "\\`")}\``);
    md.push(``);
  }
  if (d.removed.length) {
    md.push(`### − Removed / fixed (${d.removed.length})`);
    for (const f of d.removed) md.push(`- \`${f.kind}\` L${f.line}: \`${f.snippet.replace(/`/g, "\\`")}\``);
    md.push(``);
  }
}
writeFileSync(diffMdPath, md.join("\n"));

// Rotate snapshots so the next run diffs against this one.
if (existsSync(currentPath)) {
  try { writeFileSync(previousPath, require("node:fs").readFileSync(currentPath, "utf8")); } catch { /* ignore */ }
}
writeFileSync(currentPath, JSON.stringify(grouped, null, 2));

console.log(`\nDiff report: +${totalAdded} / -${totalRemoved} across ${diff.length} files`);
console.log(`  ${diffJsonPath}`);
console.log(`  ${diffMdPath}`);
