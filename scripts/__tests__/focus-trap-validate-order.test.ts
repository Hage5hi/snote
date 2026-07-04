// Verifies scripts/inspect-focus-trap.ts --validate-only walks the
// --scan-root recursively AND processes files in deterministic sorted
// order by relative path. CI relies on this for stable "first invalid"
// reporting and reproducible summary JSON ordering.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function makeArtifact(dir: string, valid: boolean) {
  mkdirSync(dir, { recursive: true });
  const payload = valid
    ? { focusHistory: [{ event: "keydown" }] }
    : { focusHistory: [{ event: 42 }] }; // schema: /focusHistory/0/event
  const file = join(dir, `focus-trap-escape-lbl.json`);
  writeFileSync(file, JSON.stringify(payload));
  return file;
}

describe("inspect-focus-trap --validate-only", () => {
  it("processes files in deterministic sorted order (recursive)", () => {
    const root = mkdtempSync(join(tmpdir(), "ft-order-"));
    // Intentionally create in reverse alphabetical order to prove the
    // script sorts rather than relying on filesystem enumeration order.
    const files = [
      makeArtifact(join(root, "z-spec-chromium-retry1"), false),
      makeArtifact(join(root, "a-spec-firefox-retry0"), false),
      makeArtifact(join(root, "m-spec-webkit-retry0"), false),
    ];
    const expected = files
      .map((f) => relative(process.cwd(), f))
      .sort((a, b) => a.localeCompare(b));

    const outJson = join(root, "summary.json");
    const res = spawnSync(
      "bun",
      ["run", "scripts/inspect-focus-trap.ts",
        "--validate-only", "--scan-root", root, "--out", outJson,
        "--invalid-dir", join(root, "_invalid")],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(2); // invalid artifacts present

    const doc = JSON.parse(readFileSync(outJson, "utf8"));
    const gotOrder: string[] = doc.entries.map((e: { file: string }) => e.file);
    expect(gotOrder).toEqual(expected);
    expect(doc.invalidFiles).toEqual(expected);
    expect(doc.firstInvalidFile).toBe(expected[0]);
  }, 30_000);

  it("--max-errors caps reporting but still scans all invalid files and exits 2", () => {
    const root = mkdtempSync(join(tmpdir(), "ft-cap-"));
    makeArtifact(join(root, "a-dir"), false);
    makeArtifact(join(root, "b-dir"), false);
    makeArtifact(join(root, "c-dir"), false);

    const outJson = join(root, "summary.json");
    const res = spawnSync(
      "bun",
      ["run", "scripts/inspect-focus-trap.ts",
        "--validate-only", "--max-errors", "1",
        "--scan-root", root, "--out", outJson,
        "--invalid-dir", join(root, "_invalid")],
      { encoding: "utf8" },
    );
    expect(res.status).toBe(2);
    const doc = JSON.parse(readFileSync(outJson, "utf8"));
    expect(doc.invalid).toBe(3);          // still scanned everything
    expect(doc.entries).toHaveLength(3);  // full summary preserved
    expect(res.stdout).toContain("--max-errors=1");
  }, 30_000);
});
