// Verifies that every entry in pretty-index.json maps to a MATCHING
// pair of `<base>.pretty.md` and `<base>.pretty.txt` artifacts by
// basename — not just that the upload globs cover all three files.
// This catches regressions where the bash generator in ci.yml starts
// emitting mismatched pretty_txt / pretty_md filenames (e.g. one
// picks up a stale `.reason` component while the other doesn't).
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");

type Entry = {
  folder: string;
  summary_file: string;
  pretty_txt: string;
  pretty_md: string;
  fail_reason: string;
  exit_code: number | null;
  pretty_status: string;
  pretty_exit_code: number;
};

function stripExt(p: string, ext: string): string {
  const b = basename(p);
  expect(b.endsWith(ext)).toBe(true);
  return b.slice(0, -ext.length);
}

function assertPaired(entries: Entry[]) {
  for (const e of entries) {
    expect(dirname(e.pretty_txt)).toBe(dirname(e.pretty_md));
    const txtBase = stripExt(e.pretty_txt, ".pretty.txt");
    const mdBase = stripExt(e.pretty_md, ".pretty.md");
    expect(mdBase).toBe(txtBase);
    // The base itself MUST embed the entry's folder + fail_reason so
    // artifact filenames are self-describing without opening the JSON.
    expect(txtBase.startsWith(e.folder)).toBe(true);
    expect(txtBase.includes(e.fail_reason)).toBe(true);
  }
}

describe("pretty-index.json ↔ *.pretty.{md,txt} basename pairing", () => {
  it("hand-crafted index: every entry has a matching md/txt pair", () => {
    const entries: Entry[] = [
      {
        folder: "20260705T134402Z-seed-42",
        summary_file: "artifacts/x/20260705T134402Z-seed-42/replay-summary.json",
        pretty_txt: "artifacts/x/pretty/20260705T134402Z-seed-42.ok.pretty.txt",
        pretty_md:  "artifacts/x/pretty/20260705T134402Z-seed-42.ok.pretty.md",
        fail_reason: "ok",
        exit_code: 0,
        pretty_status: "ok",
        pretty_exit_code: 0,
      },
      {
        folder: "20260705T111657Z-seed-999",
        summary_file: "artifacts/x/20260705T111657Z-seed-999/replay-summary.json",
        pretty_txt: "artifacts/x/pretty/20260705T111657Z-seed-999.unparseable.pretty.txt",
        pretty_md:  "artifacts/x/pretty/20260705T111657Z-seed-999.unparseable.pretty.md",
        fail_reason: "unparseable",
        exit_code: null,
        pretty_status: "parse-error",
        pretty_exit_code: 6,
      },
    ];
    assertPaired(entries);
  });

  it("regenerates a pretty/ dir via the CI bash logic and asserts pairing", () => {
    // Reproduce the essential naming logic from the "append pretty
    // replay-summary to step summary" step so filename-format
    // regressions in ci.yml surface here as well.
    const dir = mkdtempSync(join(tmpdir(), "pretty-pair-"));
    const summariesRoot = join(dir, "artifacts", "schema-drift-diff-replay");
    const prettyDir = join(dir, "artifacts", "schema-drift-diff-replay-verify", "pretty");
    mkdirSync(prettyDir, { recursive: true });

    const fixtures = [
      { folder: "20260705T111030Z-seed-777", body: { fail_reason: "concurrent-reader-timeout", exit_code: 124 } },
      { folder: "20260705T111652Z-seed-12345", body: { fail_reason: null, exit_code: 0 } }, // -> "ok"
      { folder: "20260705T134402Z-seed-42", body: { fail_reason: "path with space/bad!", exit_code: 1 } },
    ];
    for (const f of fixtures) {
      const d = join(summariesRoot, f.folder);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "replay-summary.json"), JSON.stringify(f.body));
    }

    // Mirror ci.yml: sort, sanitize fail_reason, then produce paths.
    const snippet = `
      set -eu
      shopt -s nullglob
      out_dir="${prettyDir}"
      : > "$out_dir/pretty-index.json.txt"
      for f in $(printf '%s\\n' ${summariesRoot}/*/replay-summary.json | LC_ALL=C sort); do
        base="$(basename "$(dirname "$f")")"
        reason="$(python3 -c "import json,sys
try:
  d=json.load(open(sys.argv[1]))
  r=d.get('fail_reason') or 'ok'
except Exception:
  r='unparseable'
print(r)" "$f" | tr -c '[:alnum:]._-' '_' | cut -c1-40)"
        reason="\${reason:-ok}"
        txt="$out_dir/\${base}.\${reason}.pretty.txt"
        md="$out_dir/\${base}.\${reason}.pretty.md"
        : > "$txt"
        : > "$md"
        printf '%s\\t%s\\t%s\\t%s\\n' "$base" "$reason" "$txt" "$md" >> "$out_dir/pretty-index.json.txt"
      done
    `;
    execSync(`bash -c '${snippet.replace(/'/g, "'\\''")}'`, { stdio: "inherit" });

    const lines = readFileSync(join(prettyDir, "pretty-index.json.txt"), "utf8")
      .trim().split("\n");
    expect(lines).toHaveLength(fixtures.length);

    const entries: Entry[] = lines.map((line) => {
      const [folder, reason, pretty_txt, pretty_md] = line.split("\t");
      return {
        folder,
        summary_file: join(summariesRoot, folder, "replay-summary.json"),
        pretty_txt, pretty_md,
        fail_reason: reason,
        exit_code: 0, pretty_status: "ok", pretty_exit_code: 0,
      };
    });
    assertPaired(entries);
    // And the sort order is deterministic (folder names sort lexically).
    expect(entries.map((e) => e.folder)).toEqual(
      [...fixtures.map((f) => f.folder)].sort(),
    );
  });

  it("ci.yml uses the same base for both extensions in its bash generator", () => {
    const yml = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");
    // Both matrices MUST derive txt and md from the same `${base}.${reason}`
    // prefix — otherwise the artifacts stop matching by basename.
    const matches = yml.match(
      /out="[^"]*\$\{base\}\.\$\{reason\}\.pretty\.txt"\s*\n\s*md="[^"]*\$\{base\}\.\$\{reason\}\.pretty\.md"/g,
    );
    expect(matches).not.toBeNull();
    // Once per matrix (atomic-crossos + nightly stress).
    expect(matches!.length).toBe(2);
  });
});
