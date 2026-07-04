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
  it("shuffled prev-CSV row order yields identical diff-json + json-report", () => {
    const root = mkdtempSync(join(tmpdir(), "ft-bytes-"));
    const scan = join(root, "test-results");
    const mk = (spec: string, payload: unknown) => {
      const d = join(scan, spec); mkdirSync(d, { recursive: true });
      const f = join(d, "focus-trap-escape-x.json");
      writeFileSync(f, JSON.stringify(payload));
      return f;
    };
    const fA = mk("a-spec-chromium-retry0", { focusHistory: [{ event: 42 }] });
    const fB = mk("b-spec-chromium-retry0", { focusHistory: [{ event: "keydown" }] });
    const fC = mk("c-spec-chromium-retry0", { focusHistory: [{ event: "focus" }] });

    const writePrev = (order: string[]) => {
      const prev = mkdtempSync(join(root, "prev-"));
      writeFileSync(join(prev, "focus-trap-inspect-summary.valid.csv"),
        [CSV_COLUMNS.join(","), ...order.map((f) => csvRow(f, ""))].join("\n") + "\n");
      writeFileSync(join(prev, "focus-trap-inspect-summary.invalid.csv"),
        CSV_COLUMNS.join(",") + "\n");
      return prev;
    };

    const run = (prev: string, tag: string) => {
      const djo = join(root, `diff-${tag}.json`);
      const rep = join(root, `report-${tag}.json`);
      const res = spawnSync("bun",
        ["run", "scripts/inspect-focus-trap.ts",
          "--scan-root", scan,
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

    const a = run(writePrev([fA, fB, fC]), "a");
    const b = run(writePrev([fC, fA, fB]), "b");
    const c = run(writePrev([fB, fC, fA]), "c");

    expect(JSON.stringify(b.diff)).toBe(JSON.stringify(a.diff));
    expect(JSON.stringify(c.diff)).toBe(JSON.stringify(a.diff));
    expect(JSON.stringify(b.report)).toBe(JSON.stringify(a.report));
    expect(JSON.stringify(c.report)).toBe(JSON.stringify(a.report));
  }, 90_000);
});
