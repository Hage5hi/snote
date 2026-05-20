// Verifies `--pretty` on the sticky replay CLIs produces indented JSON
// artifact files, while the default is compact single-line JSON.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runReplay as runOverlapReplay } from "../ci-sticky-newest-wins-overlap-replay";
import { runFuzzReplay } from "../ci-sticky-fuzz-failure-replay";

const MARKER = "<!-- sticky:pretty -->";

describe("--pretty flag on sticky replay CLIs", () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sticky-pretty-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("overlap replay: default writes compact single-line JSON", async () => {
    const out = join(dir, "compact.json");
    const code = await runOverlapReplay(["--out", out]);
    expect(code).toBe(0);
    const raw = readFileSync(out, "utf8").trimEnd();
    expect(raw.split("\n")).toHaveLength(1);
    expect(JSON.parse(raw).schema).toBe("sticky-replay/v1");
  });

  it("overlap replay: --pretty writes indented multi-line JSON", async () => {
    const out = join(dir, "pretty.json");
    const code = await runOverlapReplay(["--out", out, "--pretty"]);
    expect(code).toBe(0);
    const raw = readFileSync(out, "utf8");
    expect(raw.split("\n").length).toBeGreaterThan(5);
    expect(raw).toMatch(/^\{\n  "schema": "sticky-replay\/v1"/);
  });

  it("fuzz replay: default writes compact, --pretty writes indented", async () => {
    const artifact = join(dir, "art.json");
    writeFileSync(
      artifact,
      JSON.stringify({
        schema: "sticky-fuzz-failure/v1",
        seed: 1,
        iteration: 1,
        inputs: { markerLiteral: MARKER, body: `${MARKER}\nhi`, cleanedIds: [1] },
      }),
      "utf8",
    );
    const compactOut = join(dir, "compact.json");
    expect(await runFuzzReplay([artifact, "--json", compactOut])).toBe(0);
    const compact = readFileSync(compactOut, "utf8").trimEnd();
    expect(compact.split("\n")).toHaveLength(1);

    const prettyOut = join(dir, "pretty.json");
    expect(await runFuzzReplay([artifact, "--json", prettyOut, "--pretty"])).toBe(0);
    const pretty = readFileSync(prettyOut, "utf8");
    expect(pretty.split("\n").length).toBeGreaterThan(5);
    expect(pretty).toMatch(/^\{\n  "schema": "sticky-fuzz-replay\/v1"/);
  });
});
