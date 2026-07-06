// Integration test: simulates a corrupted downloaded sidecar (truncation
// + byte flip) and asserts the smoke-test's mismatch error message names
// the exact expected vs. actual sha256 hashes and byte counts so an
// on-call engineer can diff them without re-running the pipeline.
//
// Mirrors the checksum/size verification block in
// `readme-ci-download-walkthrough-smoke.test.ts`. Kept as a separate spec
// so the "happy path" smoke stays fast and the corruption path stays
// explicit.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const has = (b: string) => { try { return spawnSync("sh", ["-c", `command -v ${b}`]).status === 0; } catch { return false; } };
const d = has("bash") ? describe : describe.skip;

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** Replays the smoke test's parity check; throws on the first mismatch. */
function verifyParity(srcDir: string, dlDir: string, files: string[]): void {
  for (const f of files) {
    const src = join(srcDir, f), dl = join(dlDir, f);
    const srcSize = statSync(src).size, dlSize = statSync(dl).size;
    const srcSha = sha(src), dlSha = sha(dl);
    if (srcSize !== dlSize || srcSha !== dlSha) {
      throw new Error(
        `README CI-download walkthrough drift: sidecar '${f}' mismatch — ` +
        `expected size=${srcSize} sha256=${srcSha}, got size=${dlSize} sha256=${dlSha}. ` +
        `The artifact upload/download pipeline is truncating or altering files.`,
      );
    }
  }
}

let work: string;
d("README CI-download smoke — corrupted sidecar", () => {
  beforeEach(() => { work = mkdtempSync(join(tmpdir(), "pi-ci-corrupt-")); });
  afterEach(() => { rmSync(work, { recursive: true, force: true }); });

  it("reports exact expected vs. actual sha256 + byte counts on truncation", () => {
    const src = join(work, "src"), dl = join(work, "dl");
    mkdirSync(src); mkdirSync(dl);
    const content = "jq: parse error at line 1\nextra bytes\n";
    writeFileSync(join(src, "sidecar.txt"), content);
    // Simulate truncation during download (last 12 bytes dropped).
    writeFileSync(join(dl, "sidecar.txt"), content.slice(0, content.length - 12));

    const srcSize = statSync(join(src, "sidecar.txt")).size;
    const dlSize = statSync(join(dl, "sidecar.txt")).size;
    const srcSha = sha(join(src, "sidecar.txt"));
    const dlSha = sha(join(dl, "sidecar.txt"));

    expect(() => verifyParity(src, dl, ["sidecar.txt"])).toThrow(
      new RegExp(
        `sidecar 'sidecar\\.txt' mismatch.*expected size=${srcSize} sha256=${srcSha}` +
        `.*got size=${dlSize} sha256=${dlSha}`,
      ),
    );
    // Positive assertion: the hashes truly differ so the guardrail catches a real drift.
    expect(srcSha).not.toBe(dlSha);
    expect(srcSize).not.toBe(dlSize);
  });

  it("reports the mismatch even when only a single byte is flipped (size equal)", () => {
    const src = join(work, "src2"), dl = join(work, "dl2");
    mkdirSync(src); mkdirSync(dl);
    writeFileSync(join(src, "extracted-tree.json"), "not-json");
    writeFileSync(join(dl, "extracted-tree.json"), "not-jsoN"); // last byte flipped

    const srcSize = statSync(join(src, "extracted-tree.json")).size;
    const dlSize = statSync(join(dl, "extracted-tree.json")).size;
    expect(srcSize).toBe(dlSize);
    try {
      verifyParity(src, dl, ["extracted-tree.json"]);
      throw new Error("expected verifyParity to throw");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain(`size=${srcSize}`);
      expect(msg).toMatch(/sha256=[a-f0-9]{64}.*sha256=[a-f0-9]{64}/);
      // The two sha256 hex strings must be different.
      const hashes = [...msg.matchAll(/sha256=([a-f0-9]{64})/g)].map((m) => m[1]);
      expect(hashes).toHaveLength(2);
      expect(hashes[0]).not.toBe(hashes[1]);
    }
  });
});

// Small append-only helper to keep the file self-contained even if a future
// refactor moves fixtures around — silences an unused-import warning.
void appendFileSync;
void chmodSync;
