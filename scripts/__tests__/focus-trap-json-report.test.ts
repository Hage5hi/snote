// Verifies scripts/inspect-focus-trap.ts --json-report always emits:
//   • valid + invalid counts alongside the artifact list
//   • per-artifact failureReason / schemaPointer fields
//   • deterministic sort order (by file path)
// so downstream CI jobs can diff two runs' reports byte-for-byte.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function seed(root: string) {
  // Create artifacts in reverse alphabetical order to prove the report
  // sorts rather than trusting fs walk order.
  const specs = ["z-spec-chromium-retry0", "a-spec-firefox-retry1", "m-spec-webkit-retry0"];
  const kinds = ["valid",                    "schema",                 "parse"];
  for (let i = 0; i < specs.length; i++) {
    const dir = join(root, specs[i]);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "focus-trap-escape-lbl.json");
    if (kinds[i] === "valid")       writeFileSync(file, JSON.stringify({ focusHistory: [{ event: "keydown" }] }));
    else if (kinds[i] === "schema") writeFileSync(file, JSON.stringify({ focusHistory: [{ event: 42 }] }));
    else                            writeFileSync(file, "{not json");
  }
}

describe("inspect-focus-trap --json-report", () => {
  it("writes valid/invalid counts and per-artifact failureReason/schemaPointer in deterministic sorted order", () => {
    const root = mkdtempSync(join(tmpdir(), "ft-jr-"));
    seed(root);
    const outJson = join(root, "summary.json");
    const jsonReport = join(root, "report.json");
    const res = spawnSync(
      "bun",
      ["run", "scripts/inspect-focus-trap.ts",
        "--scan-root", root,
        "--out", outJson,
        "--json-report", jsonReport,
        "--invalid-dir", join(root, "_invalid")],
      { encoding: "utf8" },
    );
    // Two invalid artifacts → exit 2, but the JSON report must still exist.
    expect(res.status).toBe(2);

    const doc = JSON.parse(readFileSync(jsonReport, "utf8"));
    expect(doc.valid).toBe(1);
    expect(doc.invalid).toBe(2);
    expect(doc.matched).toBe(3);
    expect(doc.scanned).toBe(3);

    // Artifacts sorted by file path.
    const files: string[] = doc.artifacts.map((a: { file: string }) => a.file);
    expect(files).toEqual([...files].sort((a, b) => a.localeCompare(b)));
    expect(files.some((f) => f.includes("a-spec-firefox-retry1"))).toBe(true);

    // Every entry has the pinned failureReason/schemaPointer keys.
    for (const a of doc.artifacts) {
      expect(a).toHaveProperty("failureReason");
      expect(a).toHaveProperty("schemaPointer");
      expect(a).toHaveProperty("failureKind");
      expect(a).toHaveProperty("quarantined");
    }

    // Schema failure carries the /focusHistory/0/event pointer.
    const schemaEntry = doc.artifacts.find((a: { failureKind: string }) => a.failureKind === "schema");
    expect(schemaEntry).toBeDefined();
    expect(schemaEntry.schemaPointer).toBe("/focusHistory/0/event");
    expect(schemaEntry.failureReason).toContain("schema:");

    // Parse failure has null schemaPointer + a parse: reason.
    const parseEntry = doc.artifacts.find((a: { failureKind: string }) => a.failureKind === "parse");
    expect(parseEntry).toBeDefined();
    expect(parseEntry.schemaPointer).toBeNull();
    expect(parseEntry.failureReason.startsWith("parse")).toBe(true);

    // Deterministic: running again must produce the same byte-for-byte
    // artifacts array (ignore generatedAt).
    const res2 = spawnSync(
      "bun",
      ["run", "scripts/inspect-focus-trap.ts",
        "--scan-root", root, "--out", outJson,
        "--json-report", jsonReport,
        "--invalid-dir", join(root, "_invalid")],
      { encoding: "utf8" },
    );
    expect(res2.status).toBe(2);
    const doc2 = JSON.parse(readFileSync(jsonReport, "utf8"));
    expect(doc2.artifacts).toEqual(doc.artifacts);
    expect(doc2.issues).toEqual(doc.issues);
  }, 60_000);
});
