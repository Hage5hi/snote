// Smoke test for `scripts/ci-sticky-local-repro.ts`.
// Verifies one-command flow: takes a fuzz artifact path and produces
// both the matcher-replay JSON and the overlap-replay JSON in the
// out-dir.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLocalRepro } from "../ci-sticky-local-repro";

const MARKER = "<!-- sticky:local-repro -->";

describe("ci-sticky-local-repro CLI", () => {
  let dir: string;
  let logs: string[];
  let errs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "local-repro-"));
    logs = [];
    errs = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...a) => {
      logs.push(a.join(" "));
    });
    errSpy = vi.spyOn(console, "error").mockImplementation((...a) => {
      errs.push(a.join(" "));
    });
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs matcher replay + overlap replay and writes both JSONs to out-dir", async () => {
    const artifact = join(dir, "case-seed1-iter1.json");
    writeFileSync(
      artifact,
      JSON.stringify({
        schema: "sticky-fuzz-failure/v1",
        seed: 1,
        iteration: 1,
        inputs: { markerLiteral: MARKER, body: `${MARKER}\nbody`, cleanedIds: [7] },
      }),
      "utf8",
    );
    const outDir = join(dir, "out");
    const code = await runLocalRepro([artifact, "--out-dir", outDir]);
    expect(code).toBe(0);

    const matcherJson = join(outDir, "case-seed1-iter1.matcher-replay.json");
    const overlapJson = join(outDir, "case-seed1-iter1.overlap-replay.json");
    expect(existsSync(matcherJson)).toBe(true);
    expect(existsSync(overlapJson)).toBe(true);

    const m = JSON.parse(readFileSync(matcherJson, "utf8"));
    expect(m.schema).toBe("sticky-fuzz-replay/v1");
    expect(m.capturedAtFailure.cleanedIds).toEqual([7]);

    const o = JSON.parse(readFileSync(overlapJson, "utf8"));
    expect(o.schema).toBe("sticky-replay/v1");
    expect(o.scenario).toBe("overlap-dup-page");
  });

  it("bails with exit=1 when the fuzz artifact fails schema validation", async () => {
    const artifact = join(dir, "bad.json");
    writeFileSync(artifact, JSON.stringify({ schema: "other/v1" }), "utf8");
    const code = await runLocalRepro([artifact, "--out-dir", join(dir, "o")]);
    expect(code).toBe(1);
    expect(errs.join("\n")).toMatch(/matcher replay failed/);
  });

  it("--help prints usage and returns 0", async () => {
    const code = await runLocalRepro(["--help"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/ci-sticky-local-repro/);
  });
});
