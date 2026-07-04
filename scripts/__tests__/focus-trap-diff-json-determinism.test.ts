// Two consecutive --diff-json-out runs against identical inputs must
// produce identical `rows`, identical `changed`, and stable ordering
// (sorted by file). The volatile fields (generatedAt, meta.timestamp)
// are ignored — everything else must be byte-identical.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, DIFF_JSON_SCHEMA_VERSION } from "../_helpers/focus-trap-inspect";

function csvRow(file: string, failureReason: string): string {
  return CSV_COLUMNS.map((c) => {
    if (c === "file") return file;
    if (c === "failureReason") return /[",\n\r]/.test(failureReason) ? `"${failureReason.replace(/"/g, '""')}"` : failureReason;
    return "";
  }).join(",");
}

describe("inspect-focus-trap --diff-json-out determinism", () => {
  it("two runs produce identical changed rows in identical order", () => {
    const root = mkdtempSync(join(tmpdir(), "ft-djo-det-"));
    const scan = join(root, "test-results");
    const mk = (spec: string, payload: unknown | string) => {
      const d = join(scan, spec); mkdirSync(d, { recursive: true });
      const f = join(d, "focus-trap-escape-x.json");
      writeFileSync(f, typeof payload === "string" ? payload : JSON.stringify(payload));
      return f;
    };
    // Insertion order != alphabetical order so the sort is exercised.
    const fZ = mk("z-spec-chromium-retry0", "{broken");
    const fA = mk("a-spec-chromium-retry0", { focusHistory: [{ event: 42 }] });
    const fM = mk("m-spec-chromium-retry0", { focusHistory: [{ event: "keydown" }] });

    const prev = join(root, "prev"); mkdirSync(prev, { recursive: true });
    writeFileSync(join(prev, "focus-trap-inspect-summary.valid.csv"),
      [CSV_COLUMNS.join(","), csvRow(fM, ""), csvRow(fA, "")].join("\n") + "\n");
    writeFileSync(join(prev, "focus-trap-inspect-summary.invalid.csv"),
      [CSV_COLUMNS.join(","), csvRow(fZ, "schema: /focusHistory")].join("\n") + "\n");

    const run = (out: string) => {
      const res = spawnSync("bun",
        ["run", "scripts/inspect-focus-trap.ts",
          "--scan-root", scan,
          "--out", join(root, "summary.json"),
          "--diff-with", prev,
          "--diff-json-out", out,
          "--invalid-dir", join(root, "_invalid")],
        { encoding: "utf8" });
      expect(res.status).toBe(2);
      return JSON.parse(readFileSync(out, "utf8"));
    };
    const a = run(join(root, "a.json"));
    const b = run(join(root, "b.json"));

    // schemaVersion is pinned so downstream consumers can validate.
    expect(a.schemaVersion).toBe(DIFF_JSON_SCHEMA_VERSION);
    expect(b.schemaVersion).toBe(DIFF_JSON_SCHEMA_VERSION);

    // Rows are sorted by file, and the two runs match row-for-row.
    const files = a.rows.map((r: { file: string }) => r.file);
    expect(files).toEqual([...files].sort((x, y) => x.localeCompare(y)));
    expect(a.changed).toBe(b.changed);
    expect(a.rows).toEqual(b.rows);
  }, 60_000);
});
