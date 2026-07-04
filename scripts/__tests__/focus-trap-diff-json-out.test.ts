// Integration test for --diff-json-out:
//   - Schema: top-level shape matches the CLI's documented contract
//     (generatedAt, meta{gitSha,scanRoot,argv,timestamp}, diffWith,
//     changed, rows[]) with per-row prev/curr failureReason + schemaPointer.
//   - Determinism: rows sorted by file, and re-running with identical
//     inputs produces byte-identical output.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CSV_COLUMNS } from "../_helpers/focus-trap-inspect";

function csvRow(file: string, failureReason: string): string {
  return CSV_COLUMNS.map((c) => {
    if (c === "file") return file;
    if (c === "failureReason") {
      return /[",\n\r]/.test(failureReason) ? `"${failureReason.replace(/"/g, '""')}"` : failureReason;
    }
    return "";
  }).join(",");
}

describe("inspect-focus-trap --diff-json-out", () => {
  it("writes a schema-validated, deterministically-ordered diff JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "ft-djo-"));
    const scan = join(root, "test-results");

    const mk = (spec: string, payload: unknown | string) => {
      const dir = join(scan, spec);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, "focus-trap-escape-x.json");
      writeFileSync(file, typeof payload === "string" ? payload : JSON.stringify(payload));
      return file;
    };
    // Intentionally NOT alphabetical so we can prove the diff is sorted
    // by file rather than insertion / walk order.
    const fZ = mk("z-spec-chromium-retry0", "{broken");
    const fA = mk("a-spec-chromium-retry0", { focusHistory: [{ event: 42 }] });
    const fM = mk("m-spec-chromium-retry0", { focusHistory: [{ event: "keydown" }] }); // unchanged healthy

    const prev = join(root, "prev");
    mkdirSync(prev, { recursive: true });
    writeFileSync(
      join(prev, "focus-trap-inspect-summary.valid.csv"),
      [CSV_COLUMNS.join(","), csvRow(fM, ""), csvRow(fA, "")].join("\n") + "\n",
    );
    writeFileSync(
      join(prev, "focus-trap-inspect-summary.invalid.csv"),
      [CSV_COLUMNS.join(","), csvRow(fZ, "schema: /focusHistory")].join("\n") + "\n",
    );

    const diffOut = join(root, "diff.csv");
    const diffJsonOut = join(root, "diff.json");
    const res = spawnSync(
      "bun",
      ["run", "scripts/inspect-focus-trap.ts",
        "--scan-root", scan,
        "--out", join(root, "summary.json"),
        "--diff-with", prev,
        "--diff-out", diffOut,
        "--diff-json-out", diffJsonOut,
        "--invalid-dir", join(root, "_invalid")],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(2); // invalid artifacts present

    const doc = JSON.parse(readFileSync(diffJsonOut, "utf8"));

    // ---- schema ----
    expect(typeof doc.generatedAt).toBe("string");
    expect(doc.diffWith).toBe(prev);
    expect(typeof doc.changed).toBe("number");
    expect(Array.isArray(doc.rows)).toBe(true);
    for (const k of ["gitSha", "scanRoot", "argv", "timestamp"]) {
      expect(doc.meta, `meta.${k}`).toHaveProperty(k);
    }
    for (const r of doc.rows) {
      expect(Object.keys(r).sort()).toEqual([
        "currFailureReason", "currSchemaPointer",
        "file", "prevFailureReason", "prevSchemaPointer",
      ]);
    }

    // ---- determinism: sorted by file, matches `changed` ----
    const files = doc.rows.map((r: { file: string }) => r.file);
    expect(files).toEqual([...files].sort((a, b) => a.localeCompare(b)));
    expect(doc.changed).toBe(doc.rows.length);
    // Healthy-unchanged row must NOT appear; the two invalid ones must.
    expect(files).not.toContain(fM);
    expect(files).toContain(fA);
    expect(files).toContain(fZ);

    // ---- byte-stable across re-runs ----
    const res2 = spawnSync(
      "bun",
      ["run", "scripts/inspect-focus-trap.ts",
        "--scan-root", scan,
        "--out", join(root, "summary.json"),
        "--diff-with", prev,
        "--diff-out", diffOut,
        "--diff-json-out", diffJsonOut,
        "--invalid-dir", join(root, "_invalid")],
      { encoding: "utf8" },
    );
    expect(res2.status).toBe(2);
    const first = JSON.parse(readFileSync(diffJsonOut, "utf8"));
    // Everything except run-timestamps must be byte-identical.
    delete first.generatedAt; delete first.meta.timestamp;
    const second = JSON.parse(readFileSync(diffJsonOut, "utf8"));
    delete second.generatedAt; delete second.meta.timestamp;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  }, 60_000);
});
