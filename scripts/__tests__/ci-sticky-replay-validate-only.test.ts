// Tests for the --validate-only flag on both replay CLIs.
//
// `--validate-only <path>` reads an existing JSON file, validates it
// against the strict sticky-replay/v1 or sticky-fuzz-replay/v1 schema,
// and exits without re-running any scenario or writing any file.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runReplay as runOverlapReplay } from "../ci-sticky-newest-wins-overlap-replay";
import { runFuzzReplay } from "../ci-sticky-fuzz-failure-replay";

describe("--validate-only on sticky replay CLIs", () => {
  let dir: string;
  let logs: string[];
  let errs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sticky-validate-"));
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

  // ---- overlap replay --------------------------------------------------

  it("overlap: passes for a generated --json file (compact)", async () => {
    const f = join(dir, "ok.json");
    expect(await runOverlapReplay(["--out", f])).toBe(0);
    logs.length = 0;
    const before = readdirSync(dir).sort();
    const code = await runOverlapReplay(["--validate-only", f]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/--validate-only OK.*sticky-replay\/v1/);
    // No new file written.
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("overlap: passes for a generated --json file (pretty)", async () => {
    const f = join(dir, "pretty.json");
    expect(await runOverlapReplay(["--out", f, "--pretty"])).toBe(0);
    logs.length = 0;
    expect(await runOverlapReplay(["--validate-only", f])).toBe(0);
    expect(logs.join("\n")).toMatch(/--validate-only OK/);
  });

  it("overlap: fails with a clear error for a wrong-schema file", async () => {
    const f = join(dir, "bad.json");
    writeFileSync(f, JSON.stringify({ schema: "other/v1" }), "utf8");
    const code = await runOverlapReplay(["--validate-only", f]);
    expect(code).toBe(4); // EXIT_SCHEMA
    const e = errs.join("\n");
    expect(e).toMatch(/failed schema validation/);
    expect(e).toMatch(/at path \.schema/);
    expect(e).toMatch(/\.scenario is missing or not a string/);
    expect(e).toMatch(/got: /);
  });

  it("overlap: fails for a non-JSON file with a clear parse error", async () => {
    const f = join(dir, "broken.json");
    writeFileSync(f, "not json {{", "utf8");
    const code = await runOverlapReplay(["--validate-only", f]);
    expect(code).toBe(3); // EXIT_PARSE
    expect(errs.join("\n")).toMatch(/is not valid JSON/);
  });

  it("overlap: --validate-only does NOT require --scenario", async () => {
    // parseArgs normally errors on unknown scenario; --validate-only
    // must short-circuit that check.
    const f = join(dir, "ok2.json");
    expect(await runOverlapReplay(["--out", f])).toBe(0);
    logs.length = 0;
    const code = await runOverlapReplay([
      "--validate-only",
      f,
      "--scenario",
      "definitely-not-a-real-scenario",
    ]);
    expect(code).toBe(0);
  });

  // ---- fuzz replay -----------------------------------------------------

  it("fuzz: passes for a generated --json file", async () => {
    const marker = "<!-- sticky:vo -->";
    const artifact = join(dir, "art.json");
    writeFileSync(
      artifact,
      JSON.stringify({
        schema: "sticky-fuzz-failure/v1",
        seed: 1,
        iteration: 1,
        inputs: { markerLiteral: marker, body: `${marker}\nx`, cleanedIds: [1] },
      }),
      "utf8",
    );
    const replayOut = join(dir, "out.json");
    expect(await runFuzzReplay([artifact, "--json", replayOut])).toBe(0);
    logs.length = 0;
    errs.length = 0;
    const code = await runFuzzReplay(["--validate-only", replayOut]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toMatch(/--validate-only OK.*sticky-fuzz-replay\/v1/);
  });

  it("fuzz: fails with field-level errors including JSON path + snippet", async () => {
    const f = join(dir, "bad.json");
    writeFileSync(
      f,
      JSON.stringify({ schema: "sticky-fuzz-replay/v1", inputs: {}, matcher: {} }),
      "utf8",
    );
    const code = await runFuzzReplay(["--validate-only", f]);
    expect(code).toBe(4); // EXIT_SCHEMA
    const e = errs.join("\n");
    expect(e).toMatch(/\.inputs\.markerLiteral is missing or not a string/);
    expect(e).toMatch(/\.matcher\.headScan is missing or not an object/);
    expect(e).toMatch(/got: /);
  });
});
