// Verifies `--deterministic` on the local-repro CLI produces
// run-stable file contents: timestamp stripped, originalArtifact
// injected, and the filename includes the source artifact's name.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLocalRepro } from "../ci-sticky-local-repro";

const MARKER = "<!-- sticky:det -->";

describe("ci-sticky-local-repro --deterministic", () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "local-repro-det-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  function writeArtifact(name: string): string {
    const p = join(dir, name);
    writeFileSync(
      p,
      JSON.stringify({
        schema: "sticky-fuzz-failure/v1",
        seed: 7,
        iteration: 2,
        inputs: { markerLiteral: MARKER, body: `${MARKER}\nhi`, cleanedIds: [11] },
      }),
      "utf8",
    );
    return p;
  }

  it("uses deterministic filenames containing the original artifact name", async () => {
    const artifact = writeArtifact("case-seed7-iter2.json");
    const outDir = join(dir, "out");
    const code = await runLocalRepro([artifact, "--out-dir", outDir, "--deterministic"]);
    expect(code).toBe(0);
    expect(existsSync(join(outDir, "case-seed7-iter2.matcher-replay.json"))).toBe(true);
    expect(existsSync(join(outDir, "case-seed7-iter2.overlap-replay.json"))).toBe(true);
  });

  it("strips timestamp and injects originalArtifact in both files", async () => {
    const artifact = writeArtifact("repro-XYZ.json");
    const outDir = join(dir, "out");
    expect(
      await runLocalRepro([artifact, "--out-dir", outDir, "--deterministic"]),
    ).toBe(0);
    const m = JSON.parse(
      readFileSync(join(outDir, "repro-XYZ.matcher-replay.json"), "utf8"),
    );
    const o = JSON.parse(
      readFileSync(join(outDir, "repro-XYZ.overlap-replay.json"), "utf8"),
    );
    expect(m).not.toHaveProperty("timestamp");
    expect(o).not.toHaveProperty("timestamp");
    expect(m.originalArtifact).toBe("repro-XYZ.json");
    expect(o.originalArtifact).toBe("repro-XYZ.json");
  });

  it("produces byte-identical output across two consecutive runs", async () => {
    const artifact = writeArtifact("stable.json");
    const outDir1 = join(dir, "r1");
    const outDir2 = join(dir, "r2");
    await runLocalRepro([artifact, "--out-dir", outDir1, "--deterministic"]);
    await new Promise((r) => setTimeout(r, 5));
    await runLocalRepro([artifact, "--out-dir", outDir2, "--deterministic"]);
    const r1m = readFileSync(join(outDir1, "stable.matcher-replay.json"), "utf8");
    const r2m = readFileSync(join(outDir2, "stable.matcher-replay.json"), "utf8");
    const r1o = readFileSync(join(outDir1, "stable.overlap-replay.json"), "utf8");
    const r2o = readFileSync(join(outDir2, "stable.overlap-replay.json"), "utf8");
    expect(r1m).toBe(r2m);
    expect(r1o).toBe(r2o);
  });

  it("without --deterministic the timestamp field is kept (run-volatile)", async () => {
    const artifact = writeArtifact("vol.json");
    const outDir = join(dir, "out");
    expect(await runLocalRepro([artifact, "--out-dir", outDir])).toBe(0);
    const o = JSON.parse(
      readFileSync(join(outDir, "vol.overlap-replay.json"), "utf8"),
    );
    expect(typeof o.timestamp).toBe("string");
    expect(o).not.toHaveProperty("originalArtifact");
  });
});
