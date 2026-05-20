// Smoke test for `scripts/ci-sticky-fuzz-failure-replay.ts`.
// Reads a fixture artifact, runs the CLI directly via runFuzzReplay,
// captures stdout, and asserts the JSON output includes the
// re-executed matcher results + the captured cleanedIds.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFuzzReplay } from "../ci-sticky-fuzz-failure-replay";

const MARKER = "<!-- sticky:fuzz-replay -->";

describe("ci-sticky-fuzz-failure-replay CLI", () => {
  let dir: string;
  let logs: string[];
  let errs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fuzz-replay-"));
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

  function writeArtifact(name: string, payload: unknown): string {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(payload), "utf8");
    return p;
  }

  it("re-runs matcher paths and prints captured cleanedIds for a positive case", async () => {
    const path = writeArtifact("ok.json", {
      schema: "sticky-fuzz-failure/v1",
      name: "demo",
      seed: 42,
      iteration: 7,
      error: "boom",
      reproduce: "STICKY_FUZZ_SEED=42 bunx vitest run",
      inputs: {
        markerLiteral: MARKER,
        markerVariant: MARKER,
        body: `${MARKER}\nhello`,
        cleanedIds: [1, 2, 3],
      },
    });

    const code = await runFuzzReplay([path]);
    expect(code).toBe(0);
    const out = JSON.parse(logs.join("\n"));
    expect(out.schema).toBe("sticky-fuzz-replay/v1");
    expect(out.matcher.headScan).toEqual({ returned: true, threw: null });
    expect(out.matcher.fullScan).toEqual({ returned: true, threw: null });
    expect(out.capturedAtFailure.cleanedIds).toEqual([1, 2, 3]);
    expect(out.artifact.seed).toBe(42);
  });

  it("rejects artifacts with the wrong schema", async () => {
    const path = writeArtifact("bad.json", { schema: "other/v1", inputs: {} });
    const code = await runFuzzReplay([path]);
    expect(code).toBe(4); // EXIT_SCHEMA
    const e = errs.join("\n");
    expect(e).toMatch(/failed sticky-fuzz-failure\/v1 schema validation/);
    expect(e).toMatch(/schema=/);
  });

  it("errors with a clear field-level message when inputs.body is missing", async () => {
    const path = writeArtifact("nobody.json", {
      schema: "sticky-fuzz-failure/v1",
      seed: 1,
      iteration: 1,
      inputs: { markerLiteral: MARKER, cleanedIds: null },
    });
    const code = await runFuzzReplay([path]);
    expect(code).toBe(4); // EXIT_SCHEMA
    const e = errs.join("\n");
    expect(e).toMatch(/inputs\.body is missing or not a string/);
    expect(e).toMatch(/capture inputs\.body/);
  });

  it("rejects a non-object root with a single clear error", async () => {
    const path = writeArtifact("notobj.json", 42 as unknown as object);
    const code = await runFuzzReplay([path]);
    expect(code).toBe(1);
    expect(errs.join("\n")).toMatch(/artifact root is not a JSON object/);
  });

  it("--json <path> writes the machine-readable result to a file", async () => {
    const fs = await import("node:fs");
    const path = writeArtifact("ok2.json", {
      schema: "sticky-fuzz-failure/v1",
      seed: 1,
      iteration: 1,
      inputs: { markerLiteral: MARKER, body: `${MARKER}\nhi`, cleanedIds: [9] },
    });
    const out = join(dir, "result.json");
    const code = await runFuzzReplay([path, "--json", out]);
    expect(code).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(parsed.schema).toBe("sticky-fuzz-replay/v1");
    expect(parsed.capturedAtFailure.cleanedIds).toEqual([9]);
  });

  it("--help prints usage and returns 0", async () => {
    const code = await runFuzzReplay(["--help"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/ci-sticky-fuzz-failure-replay/);
  });
});
