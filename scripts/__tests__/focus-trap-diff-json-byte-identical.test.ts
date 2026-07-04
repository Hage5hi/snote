// Byte-identical outputs across runs where the *input ordering* varies.
// The prev-run CSVs are shuffled between runs; the CLI must still emit
// the same `--diff-json-out` rows (sorted by file) and the same
// `--json-report` artifacts list. Volatile fields (generatedAt,
// meta.timestamp, meta.argv) are stripped before the byte compare.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CSV_COLUMNS } from "../_helpers/focus-trap-inspect";

function csvRow(file: string, failureReason: string): string {
  return CSV_COLUMNS.map((c) => {
    if (c === "file") return file;
    if (c === "failureReason") return failureReason;
    return "";
  }).join(",");
}

function stripVolatile(obj: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  delete clone.generatedAt;
  const meta = clone.meta as Record<string, unknown> | undefined;
  if (meta) { delete meta.timestamp; delete meta.argv; }
  return clone;
}

describe("inspect-focus-trap byte-identical outputs across randomized input ordering", () => {
  it("shuffled prev-CSV row order + shuffled fixture write order yields identical outputs", () => {
    const root = mkdtempSync(join(tmpdir(), "ft-bytes-"));
    const scan = join(root, "test-results");

    // Distinct payloads with multiple attachment-like entries (focusHistory)
    // so any hidden dependency on write order or attachment order would
    // surface as a byte diff in --json-report / --diff-json-out.
    const specs = [
      { spec: "a-spec-chromium-retry0", payload: { focusHistory: [{ event: 42 }, { event: 7 }] } },
      { spec: "b-spec-chromium-retry0", payload: { focusHistory: [{ event: "keydown" }, { event: "keyup" }] } },
      { spec: "c-spec-chromium-retry0", payload: { focusHistory: [{ event: "focus" }, { event: "blur" }] } },
    ];

    const writeFixtures = (order: number[]) => {
      // fresh scan root per run so directory-listing order is not shared
      const s = join(root, `scan-${order.join("")}`); mkdirSync(s, { recursive: true });
      const files: string[] = [];
      for (const i of order) {
        const d = join(s, specs[i].spec); mkdirSync(d, { recursive: true });
        const f = join(d, "focus-trap-escape-x.json");
        // shuffle attachment (focusHistory) order across runs too
        const shuffled = { focusHistory: [...specs[i].payload.focusHistory].reverse() };
        writeFileSync(f, JSON.stringify(order[0] === i ? specs[i].payload : shuffled));
        files.push(f);
      }
      return { scanRoot: s, files: files.slice().sort((x, y) => x.localeCompare(y)) };
    };

    const writePrev = (validRows: string[], invalidRows: string[]) => {
      const prev = mkdtempSync(join(root, "prev-"));
      writeFileSync(join(prev, "focus-trap-inspect-summary.valid.csv"),
        [CSV_COLUMNS.join(","), ...validRows.map((f) => csvRow(f, ""))].join("\n") + "\n");
      writeFileSync(join(prev, "focus-trap-inspect-summary.invalid.csv"),
        [CSV_COLUMNS.join(","), ...invalidRows.map((f) => csvRow(f, "schema: /focusHistory/0/event [event]: expected string"))].join("\n") + "\n");
      return prev;
    };

    const run = (scanRoot: string, prev: string, tag: string) => {
      const djo = join(root, `diff-${tag}.json`);
      const rep = join(root, `report-${tag}.json`);
      const res = spawnSync("bun",
        ["run", "scripts/inspect-focus-trap.ts",
          "--scan-root", scanRoot,
          "--out", join(root, `sum-${tag}.json`),
          "--diff-with", prev,
          "--diff-json-out", djo,
          "--json-report", rep,
          "--invalid-dir", join(root, `_inv-${tag}`)],
        { encoding: "utf8" });
      expect([0, 2]).toContain(res.status);
      return {
        diff: stripVolatile(JSON.parse(readFileSync(djo, "utf8"))),
        report: stripVolatile(JSON.parse(readFileSync(rep, "utf8"))),
      };
    };

    // Run three times with different write order, different prev-CSV row
    // order, and different partitioning between valid/invalid CSVs.
    const A = writeFixtures([0, 1, 2]);
    const B = writeFixtures([2, 0, 1]);
    const C = writeFixtures([1, 2, 0]);
    const a = run(A.scanRoot, writePrev([A.files[0], A.files[1], A.files[2]], []), "a");
    const b = run(B.scanRoot, writePrev([B.files[2], B.files[0]], [B.files[1]]), "b");
    const c = run(C.scanRoot, writePrev([C.files[1]], [C.files[2], C.files[0]]), "c");

    // Files live under different scan roots per run — normalize by
    // stripping the scanRoot prefix from every `file` field before
    // comparing bytes. Everything else must match exactly.
    const norm = (o: unknown, sr: string) =>
      JSON.stringify(o).replaceAll(sr, "<SCAN>");
    expect(norm(b.diff, B.scanRoot)).toBe(norm(a.diff, A.scanRoot));
    expect(norm(c.diff, C.scanRoot)).toBe(norm(a.diff, A.scanRoot));
    expect(norm(b.report, B.scanRoot)).toBe(norm(a.report, A.scanRoot));
    expect(norm(c.report, C.scanRoot)).toBe(norm(a.report, A.scanRoot));
  }, 120_000);
});
